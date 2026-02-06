import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, setIcon } from 'obsidian';

import { PromptAggregator } from '../../core/storage/PromptAggregator';
import { VIEW_TYPE_CLAUDIAN } from '../../core/types';
import type { PromptTemplate } from '../../core/types/prompts';
import { t } from '../../i18n';
import type ClaudianPlugin from '../../main';
import { LOGO_SVG } from './constants';
import { TabBar, TabManager } from './tabs';
import type { TabData, TabId } from './tabs/types';

export class ClaudianView extends ItemView {
  private plugin: ClaudianPlugin;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private titleSlotEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private titleTextEl: HTMLElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private headerActionsContent: HTMLElement | null = null;

  // Header elements
  private historyDropdown: HTMLElement | null = null;
  private promptDropdown: HTMLElement | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: number | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudianPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches ClaudianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const originalLoad = Object.getPrototypeOf(this).load.bind(this);
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return 'Claudian';
  }

  getIcon(): string {
    return 'bot';
  }

  /** Refreshes the model selector display (used after env var changes). */
  refreshModelSelector(): void {
    const activeTab = this.tabManager?.getActiveTab();
    activeTab?.ui.modelSelector?.updateDisplay();
    activeTab?.ui.modelSelector?.renderOptions();
  }

  /** Updates hidden slash commands on all tabs (used after settings change). */
  updateHiddenSlashCommands(): void {
    const hiddenCommands = new Set(
      (this.plugin.settings.hiddenSlashCommands || []).map(c => c.toLowerCase())
    );
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(hiddenCommands);
    }
  }

  async onOpen() {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('claudian-container');

    // Build header (logo only, tab bar and actions moved to nav row)
    const header = this.viewContainerEl.createDiv({ cls: 'claudian-header' });
    this.buildHeader(header);

    // Build nav row content (tab badges + header actions)
    this.navRowContent = this.buildNavRowContent();

    // Tab content container (TabManager will populate this)
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'claudian-tab-content-container' });

    // Initialize TabManager
    this.tabManager = new TabManager(
      this.plugin,
      this.plugin.mcpManager,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateNavRowLocation();
          this.persistTabState();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateNavRowLocation();
          this.persistTabState();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.persistTabState();
        },
        onTabStreamingChanged: () => this.updateTabBar(),
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabConversationChanged: () => {
          this.persistTabState();
        },
      }
    );

    // Wire up view-level event handlers
    this.wireEventHandlers();

    // Restore tabs from persisted state or create default tab
    await this.restoreOrCreateTabs();

    // Apply initial layout (always header mode)
    this.updateLayoutForPosition();
  }

  async onClose() {
    // Cancel any pending tab bar update
    if (this.pendingTabBarUpdate !== null) {
      cancelAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    // Cleanup event refs
    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    // Persist tab state before cleanup (immediate, not debounced)
    await this.persistTabStateImmediate();

    // Destroy tab manager and all tabs
    await this.tabManager?.destroy();
    this.tabManager = null;

    // Cleanup tab bar
    this.tabBar?.destroy();
    this.tabBar = null;
  }

  // ============================================
  // UI Building
  // ============================================

  private buildHeader(header: HTMLElement) {
    this.headerEl = header;

    // Title slot container (logo + title or tabs)
    this.titleSlotEl = header.createDiv({ cls: 'claudian-title-slot' });

    // Logo (hidden when 2+ tabs)
    this.logoEl = this.titleSlotEl.createSpan({ cls: 'claudian-logo' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', LOGO_SVG.viewBox);
    svg.setAttribute('width', LOGO_SVG.width);
    svg.setAttribute('height', LOGO_SVG.height);
    svg.setAttribute('fill', 'none');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', LOGO_SVG.path);
    path.setAttribute('fill', LOGO_SVG.fill);
    svg.appendChild(path);
    this.logoEl.appendChild(svg);

    // Title text (hidden in header mode when 2+ tabs)
    this.titleTextEl = this.titleSlotEl.createEl('h4', { text: 'Claudian', cls: 'claudian-title-text' });

    // Header actions container (for header mode - initially hidden)
    this.headerActionsEl = header.createDiv({ cls: 'claudian-header-actions claudian-header-actions-slot' });
    this.headerActionsEl.style.display = 'none';
  }

  /**
   * Builds the nav row content (tab badges + header actions).
   * This is called once and the content is moved between locations.
   */
  private buildNavRowContent(): HTMLElement {
    // Create a fragment to hold nav row content
    const fragment = document.createDocumentFragment();

    // Tab badges (left side in nav row, or in title slot for header mode)
    this.tabBarContainerEl = document.createElement('div');
    this.tabBarContainerEl.className = 'claudian-tab-bar-container';
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => this.handleTabClose(tabId),
      onNewTab: () => this.handleNewTab(),
    });
    fragment.appendChild(this.tabBarContainerEl);

    // Header actions (right side)
    this.headerActionsContent = document.createElement('div');
    this.headerActionsContent.className = 'claudian-header-actions';

    // New tab button (plus icon)
    const newTabBtn = this.headerActionsContent.createDiv({ cls: 'claudian-header-btn claudian-new-tab-btn' });
    setIcon(newTabBtn, 'square-plus');
    newTabBtn.setAttribute('aria-label', t('header.newTab'));
    newTabBtn.addEventListener('click', async () => {
      await this.handleNewTab();
    });

    // New conversation button (square-pen icon - new conversation in current tab)
    const newBtn = this.headerActionsContent.createDiv({ cls: 'claudian-header-btn' });
    setIcon(newBtn, 'square-pen');
    newBtn.setAttribute('aria-label', t('header.newConversation'));
    newBtn.addEventListener('click', async () => {
      await this.tabManager?.createNewConversation();
      this.updateHistoryDropdown();
    });

    // Prompt quick panel button
    const promptBtn = this.headerActionsContent.createDiv({ cls: 'claudian-header-btn' });
    setIcon(promptBtn, 'sparkles');
    promptBtn.setAttribute('aria-label', t('promptPanel.title'));
    promptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePromptDropdown();
    });

    // Prompt dropdown (positions relative to .claudian-header)
    this.promptDropdown = this.headerActionsContent.createDiv({ cls: 'claudian-prompt-dropdown' });

    // History dropdown
    const historyContainer = this.headerActionsContent.createDiv({ cls: 'claudian-history-container' });
    const historyBtn = historyContainer.createDiv({ cls: 'claudian-header-btn' });
    setIcon(historyBtn, 'history');
    historyBtn.setAttribute('aria-label', t('header.chatHistory'));

    this.historyDropdown = historyContainer.createDiv({ cls: 'claudian-history-menu' });

    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    fragment.appendChild(this.headerActionsContent);

    // Create a wrapper div to hold the fragment (for input mode nav row)
    const wrapper = document.createElement('div');
    wrapper.style.display = 'contents';
    wrapper.appendChild(fragment);
    return wrapper;
  }

  /**
   * Moves nav row content to header (tab badges in title slot, actions in header right side).
   */
  private updateNavRowLocation(): void {
    if (!this.tabBarContainerEl || !this.headerActionsContent) return;

    // Tab badges go to title slot
    if (this.titleSlotEl) {
      this.titleSlotEl.appendChild(this.tabBarContainerEl);
    }
    // Actions go to header right side
    if (this.headerActionsEl) {
      this.headerActionsEl.appendChild(this.headerActionsContent);
      this.headerActionsEl.style.display = 'flex';
    }
  }

  /**
   * Updates layout (always header mode now).
   * Called from settings when user changes settings (though tabBarPosition is removed).
   */
  updateLayoutForPosition(): void {
    if (!this.viewContainerEl) return;

    // Always use header mode
    this.viewContainerEl.addClass('claudian-container--header-mode');

    // Move nav content to header
    this.updateNavRowLocation();

    // Update tab bar and title visibility
    this.updateTabBarVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    this.tabManager?.switchToTab(tabId);
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    const tab = this.tabManager?.getTab(tabId);
    // If streaming, treat close like user interrupt (force close cancels the stream)
    const force = tab?.state.isStreaming ?? false;
    await this.tabManager?.closeTab(tabId, force);
    this.updateTabBarVisibility();
  }

  private async handleNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxTabs ?? 3;
      new Notice(t('header.maxTabs', { count: String(maxTabs) }));
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = requestAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    });
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 2;

    // Hide tab badges when only 1 tab, show when 2+
    this.tabBarContainerEl.style.display = showTabBar ? 'flex' : 'none';

    // In header mode, badges replace logo/title in the same location
    const hideBranding = showTabBar;
    if (this.logoEl) {
      this.logoEl.style.display = hideBranding ? 'none' : '';
    }
    if (this.titleTextEl) {
      this.titleTextEl.style.display = hideBranding ? 'none' : '';
    }
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
    }
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: async (conversationId) => {
          // Check if conversation is already open in this view's tabs
          const existingTab = this.findTabWithConversation(conversationId);
          if (existingTab) {
            // Switch to existing tab instead of opening in current tab
            await this.tabManager?.switchToTab(existingTab.id);
            this.historyDropdown?.removeClass('visible');
            return;
          }

          // Check if conversation is open in another view (split workspace scenario)
          const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
          if (crossViewResult && crossViewResult.view !== this) {
            // Focus the other view's leaf and switch to the tab
            this.plugin.app.workspace.revealLeaf(crossViewResult.view.leaf);
            await crossViewResult.view.getTabManager()?.switchToTab(crossViewResult.tabId);
            this.historyDropdown?.removeClass('visible');
            return;
          }

          // Open in current tab
          await this.tabManager?.openConversation(conversationId);
          this.historyDropdown?.removeClass('visible');
        },
      });
    }
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  // ============================================
  // Prompt Quick Panel
  // ============================================

  private togglePromptDropdown(): void {
    if (!this.promptDropdown) return;

    // Close history if open
    this.historyDropdown?.removeClass('visible');

    const isVisible = this.promptDropdown.hasClass('visible');
    if (isVisible) {
      this.promptDropdown.removeClass('visible');
    } else {
      this.renderPromptDropdown();
      this.promptDropdown.addClass('visible');
    }
  }

  private renderPromptDropdown(): void {
    if (!this.promptDropdown) return;
    this.promptDropdown.empty();

    this.promptDropdown.setAttribute('role', 'dialog');
    this.promptDropdown.setAttribute('aria-label', t('promptPanel.title'));

    const aggregator = new PromptAggregator(this.plugin);
    const templates = aggregator.getAll();

    // Header
    const header = this.promptDropdown.createDiv({ cls: 'claudian-prompt-quick-header' });
    header.createSpan({ text: t('promptPanel.title') });

    const closeBtn = header.createEl('button', { cls: 'claudian-action-btn' });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.promptDropdown?.removeClass('visible');
    });

    // Search input
    const searchInput = header.createEl('input', {
      cls: 'claudian-prompt-quick-search',
      attr: { type: 'text', placeholder: t('promptPanel.search'), 'aria-label': t('promptPanel.search') },
    });
    searchInput.addEventListener('click', (e) => e.stopPropagation());
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstVisible = list.querySelector('.claudian-prompt-quick-item:not([style*="display: none"])') as HTMLElement;
        firstVisible?.focus();
      } else if (e.key === 'Escape') {
        this.promptDropdown?.removeClass('visible');
      }
    });

    // List container
    const list = this.promptDropdown.createDiv({ cls: 'claudian-prompt-quick-list' });
    list.setAttribute('role', 'listbox');

    // Filter out system prompts
    const userTemplates = templates.filter(t => t.source !== 'system');

    if (userTemplates.length === 0) {
      list.createDiv({ cls: 'claudian-prompt-quick-empty', text: t('promptPanel.empty') });
      return;
    }

    // Sort: pinned first, then by last used
    const sorted = [...userTemplates].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    });

    for (const template of sorted) {
      this.renderPromptItem(list, template, aggregator);
    }

    // Search filtering (debounced)
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const query = searchInput.value.toLowerCase().trim();
        const items = list.querySelectorAll('.claudian-prompt-quick-item');
        for (const el of items) {
          const item = el as HTMLElement;
          const name = item.dataset.name?.toLowerCase() ?? '';
          const desc = item.dataset.desc?.toLowerCase() ?? '';
          item.style.display = (!query || name.includes(query) || desc.includes(query)) ? '' : 'none';
        }
      }, 150);
    });
  }

  private renderPromptItem(
    container: HTMLElement,
    template: PromptTemplate,
    aggregator: PromptAggregator,
  ): void {
    const item = container.createDiv({
      cls: 'claudian-prompt-quick-item',
      attr: {
        'data-name': template.name,
        'data-desc': template.description ?? '',
      },
    });
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '-1');

    const content = item.createDiv({ cls: 'claudian-prompt-quick-item-content' });

    const nameRow = content.createDiv({ cls: 'claudian-prompt-quick-item-name' });
    if (template.pinned) {
      const pinIcon = nameRow.createSpan({ cls: 'claudian-prompt-quick-pin' });
      setIcon(pinIcon, 'pin');
    }
    nameRow.createSpan({ text: template.name });

    if (template.description) {
      content.createDiv({
        cls: 'claudian-prompt-quick-item-desc',
        text: template.description,
      });
    }

    // Source badge
    content.createSpan({
      cls: `claudian-prompt-quick-badge claudian-prompt-quick-badge--${template.source}`,
      text: template.source,
    });

    // Click to apply
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.applyPromptToChat(template, aggregator);
      this.promptDropdown?.removeClass('visible');
    });

    // Keyboard navigation
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.applyPromptToChat(template, aggregator);
        this.promptDropdown?.removeClass('visible');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = item.nextElementSibling as HTMLElement;
        if (next?.classList.contains('claudian-prompt-quick-item')) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = item.previousElementSibling as HTMLElement;
        if (prev?.classList.contains('claudian-prompt-quick-item')) {
          prev.focus();
        } else {
          const searchEl = this.promptDropdown?.querySelector('.claudian-prompt-quick-search') as HTMLInputElement;
          searchEl?.focus();
        }
      } else if (e.key === 'Escape') {
        this.promptDropdown?.removeClass('visible');
      }
    });
  }

  private applyPromptToChat(template: PromptTemplate, aggregator: PromptAggregator): void {
    const activeTab = this.tabManager?.getActiveTab();
    if (!activeTab) return;

    activeTab.dom.inputEl.value = template.content;
    activeTab.dom.inputEl.focus();
    activeTab.dom.inputEl.dispatchEvent(new Event('input'));

    aggregator.recordUsage(template.id);
    new Notice(t('promptPanel.applied', { name: template.name }));
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    // Document-level click to close dropdowns
    this.registerDomEvent(document, 'click', () => {
      this.historyDropdown?.removeClass('visible');
      this.promptDropdown?.removeClass('visible');
    });

    // Document-level escape to cancel streaming
    this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          e.preventDefault();
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
    });

    // Vault events - forward to active tab's file context manager
    const markDirty = (): void => {
      this.tabManager?.getActiveTab()?.ui.fileContextManager?.markFilesCacheDirty();
    };
    this.eventRefs.push(
      this.plugin.app.vault.on('create', markDirty),
      this.plugin.app.vault.on('delete', markDirty),
      this.plugin.app.vault.on('rename', markDirty),
      this.plugin.app.vault.on('modify', markDirty)
    );

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(document, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      await this.plugin.storage.clearLegacyActiveConversationId();
      return;
    }

    // No persisted state - migrate legacy activeConversationId if present
    const legacyActiveId = await this.plugin.storage.getLegacyActiveConversationId();
    if (legacyActiveId) {
      const conversation = await this.plugin.getConversationById(legacyActiveId);
      if (conversation) {
        await this.tabManager.createTab(conversation.id);
      } else {
        await this.tabManager.createTab();
      }
      await this.plugin.storage.clearLegacyActiveConversationId();
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
    await this.plugin.storage.clearLegacyActiveConversationId();
  }

  private persistTabState(): void {
    // Debounce persistence to avoid rapid writes (300ms delay)
    if (this.pendingPersist !== null) {
      clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = setTimeout(() => {
      this.pendingPersist = null;
      if (!this.tabManager) return;
      const state = this.tabManager.getPersistedState();
      this.plugin.storage.setTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.storage.setTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Clears the active tab's input textarea. */
  clearActiveInput(): void {
    const tab = this.tabManager?.getActiveTab();
    if (tab) {
      tab.dom.inputEl.value = '';
      tab.dom.inputEl.dispatchEvent(new Event('input'));
    }
  }

  /** Toggles the history dropdown visibility (delegates to private method). */
  toggleHistory(): void {
    this.toggleHistoryDropdown();
  }

  /** Switches to a tab by 0-based index. Silently ignores out-of-range index. */
  switchToTabByIndex(index: number): void {
    const tabs = this.tabManager?.getAllTabs();
    if (tabs && index >= 0 && index < tabs.length) {
      this.tabManager?.switchToTab(tabs[index].id);
    }
  }

  /** Focuses the active tab's input textarea. */
  focusInput(): void {
    const tab = this.tabManager?.getActiveTab();
    if (tab) {
      tab.dom.inputEl.focus();
    }
  }
}
