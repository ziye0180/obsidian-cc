import { Notice, setIcon } from 'obsidian';

import type { ClaudianService } from '../../../core/agent';
import type { Conversation } from '../../../core/types';
import { t } from '../../../i18n';
import type ClaudianPlugin from '../../../main';
import { cleanupThinkingBlock } from '../rendering';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { TitleGenerationService } from '../services/TitleGenerationService';
import type { ChatState } from '../state/ChatState';
import type { ExternalContextSelector, FileContextManager, ImageContextManager, McpServerSelector, StatusPanel } from '../ui';

export interface ConversationCallbacks {
  onNewConversation?: () => void;
  onConversationLoaded?: () => void;
  onConversationSwitched?: () => void;
}

export interface ConversationControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getHistoryDropdown: () => HTMLElement | null;
  getWelcomeEl: () => HTMLElement | null;
  setWelcomeEl: (el: HTMLElement | null) => void;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => HTMLTextAreaElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => ExternalContextSelector | null;
  clearQueuedMessage: () => void;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getAgentService?: () => ClaudianService | null;
}

export class ConversationController {
  private deps: ConversationControllerDeps;
  private callbacks: ConversationCallbacks;

  constructor(deps: ConversationControllerDeps, callbacks: ConversationCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  private getAgentService(): ClaudianService | null {
    return this.deps.getAgentService?.() ?? null;
  }

  // ============================================
  // Conversation Lifecycle
  // ============================================

  /**
   * Resets to entry point state (New Chat).
   *
   * Entry point is a blank UI state - no conversation is created until the
   * first message is sent. This prevents empty conversations cluttering history.
   */
  async createNew(options: { force?: boolean } = {}): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;
    const force = !!options.force;
    if (state.isStreaming && !force) return;
    if (state.isCreatingConversation) return;
    if (state.isSwitchingConversation) return;

    // Set flag to block message sending during reset
    state.isCreatingConversation = true;

    try {
      if (force && state.isStreaming) {
        state.cancelRequested = true;
        state.bumpStreamGeneration();
        this.getAgentService()?.cancel();
      }

      // Save current conversation if it has messages
      if (state.currentConversationId && state.messages.length > 0) {
        await this.save();
      }

      subagentManager.orphanAllActive();
      subagentManager.clear();

      // Clear streaming state and related DOM references
      cleanupThinkingBlock(state.currentThinkingState);
      state.currentContentEl = null;
      state.currentTextEl = null;
      state.currentTextContent = '';
      state.currentThinkingState = null;
      state.toolCallElements.clear();
      state.writeEditStates.clear();
      state.isStreaming = false;

      // Reset to entry point state - no conversation created yet
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;

      // Reset agent service session (no session ID for entry point)
      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.setSessionId(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.empty();

      // Recreate welcome element first (before StatusPanel for consistent ordering)
      const welcomeEl = messagesEl.createDiv({ cls: 'claudian-welcome' });
      welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: this.getGreeting() });
      void this.populateWelcome(welcomeEl);
      this.deps.setWelcomeEl(welcomeEl);

      // Remount StatusPanel to restore state for new conversation
      this.deps.getStatusPanel()?.remount();
      this.deps.getStatusPanel()?.clearSubagents();

      this.deps.getInputEl().value = '';

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      this.deps.getImageContextManager()?.clearImages();
      this.deps.getMcpServerSelector()?.clearEnabled();
      // Pass current settings to ensure we have the most up-to-date persistent paths
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
      this.deps.clearQueuedMessage();

      this.callbacks.onNewConversation?.();
    } finally {
      state.isCreatingConversation = false;
    }
  }

  /**
   * Loads the current tab conversation, or starts at entry point if none.
   *
   * Entry point (no conversation) shows welcome screen without
   * creating a conversation. Conversation is created lazily on first message.
   */
  async loadActive(): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const conversationId = state.currentConversationId;
    const conversation = conversationId ? await plugin.getConversationById(conversationId) : null;

    // No active conversation - start at entry point
    if (!conversation) {
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;

      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.setSessionId(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      // Initialize external contexts with persistent paths from settings
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );

      this.deps.getMcpServerSelector()?.clearEnabled();

      const welcomeEl = renderer.renderMessages(
        [],
        () => this.getGreeting()
      );
      void this.populateWelcome(welcomeEl);
      this.deps.setWelcomeEl(welcomeEl);
      this.updateWelcomeVisibility();

      this.callbacks.onConversationLoaded?.();
      return;
    }

    // Load existing conversation
    state.currentConversationId = conversation.id;
    state.messages = [...conversation.messages];
    state.usage = conversation.usage ?? null;
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;

    // Clear status panels (auto-hide: panels reappear when agent creates new todos/subagents)
    state.currentTodos = null;
    this.deps.getStatusPanel()?.clearSubagents();

    const hasMessages = state.messages.length > 0;

    // Determine external context paths for this session
    // Empty session: use persistent paths; session with messages: use saved paths
    const externalContextPaths = hasMessages
      ? conversation.externalContextPaths || []
      : plugin.settings.persistentExternalContextPaths || [];

    this.getAgentService()?.setSessionId(conversation.sessionId ?? null, externalContextPaths);
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForLoadedConversation(hasMessages);

    if (conversation.currentNote) {
      fileCtx?.setCurrentNote(conversation.currentNote);
    } else if (!hasMessages) {
      fileCtx?.autoAttachActiveFile();
    }

    // Restore external context paths based on session state
    this.restoreExternalContextPaths(
      conversation.externalContextPaths,
      !hasMessages
    );

    // Restore enabled MCP servers (or clear for new conversation)
    const mcpServerSelector = this.deps.getMcpServerSelector();
    if (conversation.enabledMcpServers && conversation.enabledMcpServers.length > 0) {
      mcpServerSelector?.setEnabledServers(conversation.enabledMcpServers);
    } else {
      mcpServerSelector?.clearEnabled();
    }

    const welcomeEl = renderer.renderMessages(
      state.messages,
      () => this.getGreeting()
    );
    void this.populateWelcome(welcomeEl);
    this.deps.setWelcomeEl(welcomeEl);
    this.updateWelcomeVisibility();

    this.callbacks.onConversationLoaded?.();
  }

  /** Switches to a different conversation. */
  async switchTo(id: string): Promise<void> {
    const { plugin, state, renderer, subagentManager } = this.deps;

    if (id === state.currentConversationId) return;
    if (state.isStreaming) return;
    if (state.isSwitchingConversation) return;
    if (state.isCreatingConversation) return;

    state.isSwitchingConversation = true;

    try {
      await this.save();

      subagentManager.orphanAllActive();
      subagentManager.clear();

      const conversation = await plugin.switchConversation(id);
      if (!conversation) {
        return;
      }

      state.currentConversationId = conversation.id;
      state.messages = [...conversation.messages];
      state.usage = conversation.usage ?? null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;

      // Clear status panels (auto-hide: panels reappear when agent creates new todos/subagents)
      state.currentTodos = null;
      this.deps.getStatusPanel()?.clearSubagents();

      const hasMessages = state.messages.length > 0;

      // Determine external context paths for this session
      // Empty session: use persistent paths; session with messages: use saved paths
      const externalContextPaths = hasMessages
        ? conversation.externalContextPaths || []
        : plugin.settings.persistentExternalContextPaths || [];

      // Update agent service session ID with correct external contexts
      this.getAgentService()?.setSessionId(conversation.sessionId ?? null, externalContextPaths);

      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForLoadedConversation(hasMessages);

      if (conversation.currentNote) {
        fileCtx?.setCurrentNote(conversation.currentNote);
      }

      // Restore external context paths based on session state
      this.restoreExternalContextPaths(
        conversation.externalContextPaths,
        !hasMessages
      );

      // Restore enabled MCP servers (or clear if none)
      const mcpServerSelector = this.deps.getMcpServerSelector();
      if (conversation.enabledMcpServers && conversation.enabledMcpServers.length > 0) {
        mcpServerSelector?.setEnabledServers(conversation.enabledMcpServers);
      } else {
        mcpServerSelector?.clearEnabled();
      }

      const welcomeEl = renderer.renderMessages(
        state.messages,
        () => this.getGreeting()
      );
      void this.populateWelcome(welcomeEl);
      this.deps.setWelcomeEl(welcomeEl);

      this.deps.getHistoryDropdown()?.removeClass('visible');
      this.updateWelcomeVisibility();

      this.callbacks.onConversationSwitched?.();
    } finally {
      state.isSwitchingConversation = false;
    }
  }

  /**
   * Saves the current conversation.
   *
   * If we're at an entry point (no conversation yet) and have messages,
   * creates a new conversation first (lazy creation).
   *
   * For native sessions (new conversations with sessionId from SDK),
   * only metadata is saved - the SDK handles message persistence.
   */
  async save(updateLastResponse = false): Promise<void> {
    const { plugin, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentConversationId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();
    const sessionId = agentService?.getSessionId() ?? null;
    const sessionInvalidated = agentService?.consumeSessionInvalidation?.() ?? false;

    // Entry point with messages - create conversation lazily
    // New conversations always use SDK-native storage.
    if (!state.currentConversationId && state.messages.length > 0) {
      const conversation = await plugin.createConversation(sessionId ?? undefined);
      state.currentConversationId = conversation.id;
    }

    const fileCtx = this.deps.getFileContextManager();
    const currentNote = fileCtx?.getCurrentNotePath() || undefined;
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = externalContextSelector?.getExternalContexts() ?? [];
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const enabledMcpServers = mcpServerSelector ? Array.from(mcpServerSelector.getEnabledServers()) : [];

    // Check if this is a native session and promote legacy sessions after first SDK session capture
    const conversation = await plugin.getConversationById(state.currentConversationId!);
    const wasNative = conversation?.isNative ?? false;
    const shouldPromote = !wasNative && !!sessionId;
    const isNative = wasNative || shouldPromote;
    const legacyMessages = conversation?.messages ?? [];
    const legacyCutoffAt = shouldPromote
      ? legacyMessages[legacyMessages.length - 1]?.timestamp
      : conversation?.legacyCutoffAt;

    // Detect session change (resume failed, SDK created new session)
    // Move old sdkSessionId to previousSdkSessionIds for history merging on reload
    // Use Set to deduplicate in case of race conditions or repeated session changes
    const oldSdkSessionId = conversation?.sdkSessionId;
    const sessionChanged = isNative && sessionId && oldSdkSessionId && sessionId !== oldSdkSessionId;
    const previousSdkSessionIds = sessionChanged
      ? [...new Set([...(conversation?.previousSdkSessionIds || []), oldSdkSessionId])]
      : conversation?.previousSdkSessionIds;

    const updates: Partial<Conversation> = {
      // For native sessions, don't persist messages (SDK handles that)
      // For legacy sessions, persist messages as before
      messages: isNative ? state.messages : state.getPersistedMessages(),
      // Preserve existing sessionId when SDK hasn't captured a new one yet
      sessionId: sessionInvalidated ? null : (sessionId ?? conversation?.sessionId ?? null),
      sdkSessionId: isNative && sessionId ? sessionId : conversation?.sdkSessionId,
      previousSdkSessionIds,
      isNative: isNative || undefined,
      legacyCutoffAt,
      sdkMessagesLoaded: isNative ? true : undefined,
      currentNote: currentNote,
      externalContextPaths: externalContextPaths.length > 0 ? externalContextPaths : undefined,
      usage: state.usage ?? undefined,
      enabledMcpServers: enabledMcpServers.length > 0 ? enabledMcpServers : undefined,
    };

    if (updateLastResponse) {
      updates.lastResponseAt = Date.now();
    }

    // At this point, currentConversationId is guaranteed to be set
    // (either existed before or was created lazily above)
    await plugin.updateConversation(state.currentConversationId!, updates);
  }

  /**
   * Restores external context paths based on session state.
   * New or empty sessions get current persistent paths from settings.
   * Sessions with messages restore exactly what was saved.
   */
  private restoreExternalContextPaths(
    savedPaths: string[] | undefined,
    isEmptySession: boolean
  ): void {
    const { plugin } = this.deps;
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (!externalContextSelector) {
      return;
    }

    if (isEmptySession) {
      // Empty session: use current persistent paths from settings
      externalContextSelector.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
    } else {
      // Session with messages: restore exactly what was saved
      externalContextSelector.setExternalContexts(savedPaths || []);
    }
  }

  // ============================================
  // History Dropdown
  // ============================================

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.hasClass('visible');
    if (isVisible) {
      dropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectConversation: (id) => this.switchTo(id),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  /**
   * Renders history dropdown items to a container.
   * Shared implementation for updateHistoryDropdown() and renderHistoryDropdown().
   *
   * DOM structure is preserved for compatibility:
   *   container.children[0] = header (title + close + search)
   *   container.children[1] = list (only .claudian-history-item elements)
   *
   * Date group titles are rendered via CSS ::before on items with data-group-first.
   */
  private renderHistoryItems(
    container: HTMLElement,
    options: {
      onSelectConversation: (id: string) => Promise<void>;
      onRerender: () => void;
    }
  ): void {
    const { plugin, state } = this.deps;

    container.empty();

    // Header: title + close button + search input
    const dropdownHeader = container.createDiv({ cls: 'claudian-history-header' });
    dropdownHeader.createSpan({ text: t('history.title') });

    const closeBtn = dropdownHeader.createEl('button', { cls: 'claudian-action-btn' });
    setIcon(closeBtn, 'x');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.removeClass('visible');
    });

    const searchInput = dropdownHeader.createEl('input', {
      cls: 'claudian-history-search',
      attr: { type: 'text', placeholder: t('history.search'), 'aria-label': t('history.search') },
    });
    searchInput.addEventListener('click', (e) => e.stopPropagation());

    const list = container.createDiv({ cls: 'claudian-history-list' });
    list.setAttribute('role', 'listbox');
    const allConversations = plugin.getConversationList();

    if (allConversations.length === 0) {
      list.createDiv({ cls: 'claudian-history-empty', text: t('history.empty') });
      return;
    }

    // Sort by lastResponseAt (fallback to createdAt) descending
    const conversations = [...allConversations].sort((a, b) => {
      return (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt);
    });

    // Render items with date group markers via data attributes
    let currentGroup = '';
    for (const conv of conversations) {
      const group = this.getDateGroup(conv.lastResponseAt ?? conv.createdAt);
      const isFirstInGroup = group !== currentGroup;
      if (isFirstInGroup) currentGroup = group;

      const isCurrent = conv.id === state.currentConversationId;
      const item = list.createDiv({
        cls: `claudian-history-item${isCurrent ? ' active' : ''}`,
        attr: { 'data-group': group },
      });
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');

      // Mark first item in each date group for CSS ::before rendering
      if (isFirstInGroup) {
        item.dataset.groupFirst = group;
      }

      const iconEl = item.createDiv({ cls: 'claudian-history-item-icon' });
      setIcon(iconEl, isCurrent ? 'message-square-dot' : 'message-square');

      const content = item.createDiv({ cls: 'claudian-history-item-content' });
      const titleEl = content.createDiv({ cls: 'claudian-history-item-title', text: conv.title });
      titleEl.setAttribute('title', conv.title);
      content.createDiv({
        cls: 'claudian-history-item-date',
        text: isCurrent ? t('history.currentSession') : this.formatDate(conv.lastResponseAt ?? conv.createdAt),
      });

      if (!isCurrent) {
        content.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await options.onSelectConversation(conv.id);
          } catch {
            // Silently ignore selection errors
          }
        });
      }

      const actions = item.createDiv({ cls: 'claudian-history-item-actions' });

      // Show regenerate button if title generation failed, or loading indicator if pending
      if (conv.titleGenerationStatus === 'pending') {
        const loadingEl = actions.createEl('span', { cls: 'claudian-action-btn claudian-action-loading' });
        setIcon(loadingEl, 'loader-2');
        loadingEl.setAttribute('aria-label', 'Generating title...');
      } else if (conv.titleGenerationStatus === 'failed') {
        const regenerateBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
        setIcon(regenerateBtn, 'refresh-cw');
        regenerateBtn.setAttribute('aria-label', 'Regenerate title');
        regenerateBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await this.regenerateTitle(conv.id);
          } catch {
            // Silently ignore regeneration errors
          }
        });
      }

      const exportBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
      setIcon(exportBtn, 'download');
      exportBtn.setAttribute('aria-label', 'Export');
      exportBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.exportConversation(conv.id);
      });

      const renameBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
      setIcon(renameBtn, 'pencil');
      renameBtn.setAttribute('aria-label', 'Rename');
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRenameInput(item, conv.id, conv.title);
      });

      const deleteBtn = actions.createEl('button', { cls: 'claudian-action-btn claudian-delete-btn' });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.setAttribute('aria-label', 'Delete');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (state.isStreaming) return;
        try {
          await plugin.deleteConversation(conv.id);
          options.onRerender();

          if (conv.id === state.currentConversationId) {
            await this.loadActive();
          }
        } catch {
          // Silently ignore deletion errors
        }
      });

      // Keyboard navigation for history items
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = item.nextElementSibling as HTMLElement;
          if (next?.classList.contains('claudian-history-item')) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = item.previousElementSibling as HTMLElement;
          if (prev?.classList.contains('claudian-history-item')) {
            prev.focus();
          } else {
            searchInput.focus();
          }
        } else if (e.key === 'Escape') {
          container.removeClass('visible');
        }
      });
    }

    // Keyboard navigation for search input
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstVisible = list.querySelector('.claudian-history-item:not([style*="display: none"])') as HTMLElement;
        firstVisible?.focus();
      } else if (e.key === 'Escape') {
        container.removeClass('visible');
      }
    });

    // Debounced search filtering
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.filterHistoryItems(list, searchInput.value.toLowerCase().trim());
      }, 150);
    });
  }

  /** Shows inline rename input for a conversation. */
  private showRenameInput(item: HTMLElement, convId: string, currentTitle: string): void {
    const titleEl = item.querySelector('.claudian-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'claudian-rename-input';
    input.value = currentTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      try {
        const newTitle = input.value.trim() || currentTitle;
        await this.deps.plugin.renameConversation(convId, newTitle);
        this.updateHistoryDropdown();
      } catch {
        // Silently ignore rename errors
      }
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', async (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.isComposing) {
        input.blur();
      } else if (e.key === 'Escape' && !e.isComposing) {
        input.value = currentTitle;
        input.blur();
      }
    });
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /**
   * Populates the welcome element with pinned commands and quick actions.
   * Silently degrades when commands fail to load.
   */
  async populateWelcome(welcomeEl: HTMLElement): Promise<void> {
    const { plugin } = this.deps;

    // -- Pinned commands --
    try {
      const allCommands = await plugin.storage.loadAllSlashCommands();
      const pinned = allCommands.filter(c => c.pinned);
      const commands = pinned.length > 0
        ? pinned.slice(0, 5)
        : allCommands.slice(0, 3);

      if (commands.length > 0) {
        const commandsEl = welcomeEl.createDiv({ cls: 'claudian-welcome-commands' });
        for (const cmd of commands) {
          const cmdEl = commandsEl.createDiv({ cls: 'claudian-welcome-cmd' });
          cmdEl.createSpan({ cls: 'claudian-welcome-cmd-name', text: `/${cmd.name}` });
          if (cmd.description) {
            cmdEl.createSpan({ cls: 'claudian-welcome-cmd-desc', text: cmd.description });
          }
          cmdEl.addEventListener('click', () => {
            const inputEl = this.deps.getInputEl();
            inputEl.value = `/${cmd.name} `;
            inputEl.focus();
            inputEl.dispatchEvent(new Event('input'));
          });
        }
      }
    } catch {
      // Silent degradation: skip commands section
    }

    // -- Quick actions --
    const actionsEl = welcomeEl.createDiv({ cls: 'claudian-welcome-actions' });

    const addContextBtn = actionsEl.createDiv({ cls: 'claudian-welcome-action-btn' });
    setIcon(addContextBtn, 'at-sign');
    addContextBtn.createSpan({ text: 'Add context' });
    addContextBtn.addEventListener('click', () => {
      const inputEl = this.deps.getInputEl();
      inputEl.value = '@';
      inputEl.focus();
      inputEl.dispatchEvent(new Event('input'));
    });

    const instructionBtn = actionsEl.createDiv({ cls: 'claudian-welcome-action-btn' });
    setIcon(instructionBtn, 'hash');
    instructionBtn.createSpan({ text: 'Instructions' });
    instructionBtn.addEventListener('click', () => {
      const inputEl = this.deps.getInputEl();
      inputEl.value = '#';
      inputEl.focus();
      inputEl.dispatchEvent(new Event('input'));
    });
  }

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const name = this.deps.plugin.settings.userName?.trim();

    // Helper to optionally personalize a greeting (with fallback for no-name case)
    const personalize = (base: string, noNameFallback?: string): string =>
      name ? `${base}, ${name}` : (noNameFallback ?? base);

    // Day-specific greetings (some personalized, some universal)
    const dayGreetings: Record<number, string[]> = {
      0: [personalize('Happy Sunday'), 'Sunday session?', 'Welcome to the weekend'],
      1: [personalize('Happy Monday'), personalize('Back at it', 'Back at it!')],
      2: [personalize('Happy Tuesday')],
      3: [personalize('Happy Wednesday')],
      4: [personalize('Happy Thursday')],
      5: [personalize('Happy Friday'), personalize('That Friday feeling')],
      6: [personalize('Happy Saturday', 'Happy Saturday!'), personalize('Welcome to the weekend')],
    };

    // Time-specific greetings
    const getTimeGreetings = (): string[] => {
      if (hour >= 5 && hour < 12) {
        return [personalize('Good morning'), 'Coffee and Claudian time?'];
      } else if (hour >= 12 && hour < 18) {
        return [personalize('Good afternoon'), personalize('Hey there'), personalize("How's it going") + '?'];
      } else if (hour >= 18 && hour < 22) {
        return [personalize('Good evening'), personalize('Evening'), personalize('How was your day') + '?'];
      } else {
        return ['Hello, night owl', personalize('Evening')];
      }
    };

    // General greetings
    const generalGreetings = [
      personalize('Hey there'),
      name ? `Hi ${name}, how are you?` : 'Hi, how are you?',
      personalize("How's it going") + '?',
      personalize('Welcome back') + '!',
      personalize("What's new") + '?',
      ...(name ? [`${name} returns!`] : []),
      'Hello ziye how can I help you today?',
    ];

    // Combine day + time + general greetings, pick randomly
    const allGreetings = [
      ...(dayGreetings[day] || []),
      ...getTimeGreetings(),
      ...generalGreetings,
    ];

    return allGreetings[Math.floor(Math.random() * allGreetings.length)];
  }

  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    if (this.deps.state.messages.length === 0) {
      welcomeEl.style.display = '';
    } else {
      welcomeEl.style.display = 'none';
    }
  }

  /**
   * Initializes the welcome greeting for a new tab without a conversation.
   * Called when a new tab is activated and has no conversation loaded.
   */
  initializeWelcome(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    // Initialize file context to auto-attach the currently focused note
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForNewConversation();
    fileCtx?.autoAttachActiveFile();

    // Only add greeting if not already present
    if (!welcomeEl.querySelector('.claudian-welcome-greeting')) {
      welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: this.getGreeting() });
      void this.populateWelcome(welcomeEl);
    }

    this.updateWelcomeVisibility();
  }

  // ============================================
  // Export
  // ============================================

  async exportConversation(conversationId?: string): Promise<void> {
    const { plugin, state } = this.deps;
    const targetId = conversationId ?? state.currentConversationId;
    if (!targetId) return;

    const conversation = await plugin.getConversationById(targetId);
    if (!conversation || conversation.messages.length === 0) {
      new Notice(t('export.noMessages'));
      return;
    }

    const markdown = this.formatConversationAsMarkdown(conversation);
    const sanitizedTitle = conversation.title.replace(/[\\/:*?"<>|]/g, '-').substring(0, 50);
    const date = new Date().toISOString().split('T')[0];
    const fileName = `Claudian-exports/${sanitizedTitle}-${date}.md`;

    try {
      await plugin.storage.getAdapter().write(fileName, markdown);
      new Notice(t('export.success', { fileName }));
    } catch (error) {
      new Notice(t('export.failed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private formatConversationAsMarkdown(conversation: Conversation): string {
    const lines: string[] = [];
    const date = new Date(conversation.createdAt);

    lines.push(`# ${conversation.title}`);
    lines.push('');
    lines.push(`*${t('export.headerExported', { date: new Date().toLocaleDateString() })}*`);
    lines.push(`*${t('export.headerCreated', { date: `${date.toLocaleDateString()} ${date.toLocaleTimeString()}` })}*`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of conversation.messages) {
      if (msg.isRebuiltContext || msg.isInterrupt) continue;

      const roleLabel = msg.role === 'user' ? t('export.roleUser') : t('export.roleAssistant');
      lines.push(`## ${roleLabel}`);
      lines.push('');

      const content = msg.displayContent || msg.content;
      lines.push(content);
      lines.push('');

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tool of msg.toolCalls) {
          lines.push(`> **${t('export.toolLabel', { name: tool.name })}**`);
          if (tool.status === 'error') {
            lines.push(`> *${t('export.toolError')}*`);
          }
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage: string): string {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

  /** Regenerates AI title for a conversation. */
  async regenerateTitle(conversationId: string): Promise<void> {
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;

    // Get the full conversation from cache
    const fullConv = await plugin.getConversationById(conversationId);
    if (!fullConv || fullConv.messages.length < 1) return;

    // Find first user message by role (not by index)
    const firstUserMsg = fullConv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Store current title to check if user renames during generation
    const expectedTitle = fullConv.title;

    // Set pending status before starting generation
    await plugin.updateConversation(conversationId, { titleGenerationStatus: 'pending' });
    this.updateHistoryDropdown();

    // Fire async AI title generation
    await titleService.generateTitle(
      conversationId,
      userContent,
      async (convId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(convId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches expected)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(convId, result.title);
          await plugin.updateConversation(convId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep existing title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(convId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(convId, { titleGenerationStatus: undefined });
        }
        this.updateHistoryDropdown();
      }
    );
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Returns a date group label for grouping conversations. */
  private getDateGroup(timestamp: number): string {
    const now = new Date();
    const date = new Date(timestamp);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    if (date >= today) return 'Today';
    if (date >= yesterday) return 'Yesterday';
    if (date >= weekAgo) return 'This week';
    return 'Earlier';
  }

  /** Filters history items by search query and updates group-first markers. */
  private filterHistoryItems(list: HTMLElement, query: string): void {
    const items = list.querySelectorAll('.claudian-history-item');

    // Track first visible item per group for CSS ::before group titles
    const firstVisibleByGroup = new Map<string, HTMLElement>();

    for (const el of items) {
      const item = el as HTMLElement;
      const titleEl = item.querySelector('.claudian-history-item-title');
      const title = titleEl?.textContent?.toLowerCase() ?? '';
      const matches = !query || title.includes(query);

      item.style.display = matches ? '' : 'none';

      // Clear previous group-first marker
      delete item.dataset.groupFirst;

      if (matches) {
        const group = item.dataset.group;
        if (group && !firstVisibleByGroup.has(group)) {
          firstVisibleByGroup.set(group, item);
        }
      }
    }

    // Re-apply group-first markers to first visible item in each group
    for (const [group, item] of firstVisibleByGroup) {
      item.dataset.groupFirst = group;
    }
  }

  // ============================================
  // History Dropdown Rendering (for ClaudianView)
  // ============================================

  /**
   * Renders the history dropdown content to a provided container.
   * Used by ClaudianView to render the dropdown with custom selection callback.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: { onSelectConversation: (id: string) => Promise<void> }
  ): void {
    this.renderHistoryItems(container, {
      onSelectConversation: options.onSelectConversation,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }
}
