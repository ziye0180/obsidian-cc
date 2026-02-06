import { Notice, setIcon } from 'obsidian';

import { PromptAggregator } from '../../../../core/storage/PromptAggregator';
import type { PromptSource, PromptTemplate } from '../../../../core/types/prompts';
import { t } from '../../../../i18n';
import type ClaudianPlugin from '../../../../main';
import { confirmDelete } from '../../../../shared/modals/ConfirmModal';
import { PromptEditModal } from '../../../../shared/modals/PromptEditModal';

const SOURCE_LABEL_KEYS: Record<PromptSource, 'promptManager.source.command' | 'promptManager.source.skill' | 'promptManager.source.agent' | 'promptManager.source.system'> = {
  command: 'promptManager.source.command',
  skill: 'promptManager.source.skill',
  agent: 'promptManager.source.agent',
  system: 'promptManager.source.system',
};

const ALL_SOURCES: (PromptSource | 'all')[] = ['all', 'command', 'skill', 'agent', 'system'];

export class PromptsTabView {
  private containerEl: HTMLElement;
  private plugin: ClaudianPlugin;
  private aggregator: PromptAggregator;
  private listEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private sourceFilter: PromptSource | null = null;
  private filterMenuEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, plugin: ClaudianPlugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.aggregator = new PromptAggregator(plugin);
    this.render();
  }

  private render(): void {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-prompt-header' });

    const searchWrap = headerEl.createDiv({ cls: 'claudian-prompt-search' });
    this.searchInput = searchWrap.createEl('input', {
      type: 'text',
      placeholder: t('promptManager.searchPlaceholder'),
      cls: 'claudian-prompt-search-input',
    });
    this.searchInput.addEventListener('input', () => this.renderList());

    const actionsEl = headerEl.createDiv({ cls: 'claudian-prompt-actions' });

    // Source filter dropdown
    const filterWrap = actionsEl.createDiv({ cls: 'claudian-prompt-filter-wrap' });
    filterWrap.style.position = 'relative';

    const filterBtn = filterWrap.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': t('promptManager.filter') },
    });
    setIcon(filterBtn, 'filter');
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFilterMenu(filterWrap);
    });

    // Add new prompt
    const addBtn = actionsEl.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': t('promptManager.add') },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openEditor(null));

    this.listEl = this.containerEl.createDiv({ cls: 'claudian-prompt-list' });
    this.renderList();
  }

  private toggleFilterMenu(parentEl: HTMLElement): void {
    if (this.filterMenuEl) {
      this.closeFilterMenu();
      return;
    }

    this.filterMenuEl = parentEl.createDiv({ cls: 'claudian-prompt-filter-menu' });

    for (const source of ALL_SOURCES) {
      const label = source === 'all' ? t('promptManager.filterAll') : t(SOURCE_LABEL_KEYS[source]);
      const isActive = source === 'all' ? !this.sourceFilter : this.sourceFilter === source;

      const item = this.filterMenuEl.createEl('button', {
        text: label,
        cls: `claudian-prompt-filter-item${isActive ? ' claudian-prompt-filter-item--active' : ''}`,
      });
      item.addEventListener('click', () => {
        this.sourceFilter = source === 'all' ? null : source;
        this.closeFilterMenu();
        this.renderList();
      });
    }

    const closeHandler = (e: MouseEvent) => {
      if (!parentEl.contains(e.target as Node)) {
        this.closeFilterMenu();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  private closeFilterMenu(): void {
    this.filterMenuEl?.remove();
    this.filterMenuEl = null;
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const query = this.searchInput?.value ?? '';
    const templates = this.aggregator.filter({
      query: query || undefined,
      source: this.sourceFilter ?? undefined,
    });

    if (templates.length === 0) {
      const emptyEl = this.listEl.createDiv({ cls: 'claudian-prompt-empty' });
      const emptyIcon = emptyEl.createSpan();
      setIcon(emptyIcon, 'message-square');
      emptyEl.createSpan({
        text: query ? t('promptManager.noResults') : t('promptManager.empty'),
      });
      return;
    }

    for (const template of templates) {
      this.renderPromptCard(template);
    }
  }

  private renderPromptCard(template: PromptTemplate): void {
    if (!this.listEl) return;

    const card = this.listEl.createDiv({ cls: 'claudian-prompt-card' });

    const infoEl = card.createDiv({ cls: 'claudian-prompt-card-info' });

    const nameRow = infoEl.createDiv({ cls: 'claudian-prompt-card-name-row' });
    nameRow.createSpan({ text: template.name, cls: 'claudian-prompt-card-name' });

    nameRow.createSpan({
      text: t(SOURCE_LABEL_KEYS[template.source]),
      cls: `claudian-prompt-tag claudian-prompt-tag--${template.source}`,
    });

    if (template.category) {
      nameRow.createSpan({
        text: template.category,
        cls: 'claudian-prompt-tag claudian-prompt-tag--category',
      });
    }

    if (template.description) {
      infoEl.createDiv({
        text: template.description,
        cls: 'claudian-prompt-card-desc',
      });
    }

    const preview = template.content.substring(0, 80) +
      (template.content.length > 80 ? '...' : '');
    infoEl.createDiv({
      text: preview,
      cls: 'claudian-prompt-card-preview',
    });

    // Actions
    const cardActions = card.createDiv({ cls: 'claudian-prompt-card-actions' });

    if (template.pinned) {
      const pinnedIcon = cardActions.createSpan({ cls: 'claudian-prompt-card-pinned' });
      setIcon(pinnedIcon, 'pin');
    }

    // Apply to chat
    const applyBtn = cardActions.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': t('promptManager.applyToChat') },
    });
    setIcon(applyBtn, 'zap');
    applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.applyToChat(template);
    });

    // Edit (commands, skills, and agents in read-only mode)
    if (template.source === 'command' || template.source === 'skill') {
      // Duplicate
      const dupBtn = cardActions.createEl('button', {
        cls: 'claudian-settings-action-btn',
        attr: { 'aria-label': t('promptManager.duplicate') },
      });
      setIcon(dupBtn, 'copy');
      dupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.duplicatePrompt(template);
      });

      const editBtn = cardActions.createEl('button', {
        cls: 'claudian-settings-action-btn',
        attr: { 'aria-label': t('common.edit') },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditor(template);
      });

      const deleteBtn = cardActions.createEl('button', {
        cls: 'claudian-settings-action-btn',
        attr: { 'aria-label': t('common.delete') },
      });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await confirmDelete(
          this.plugin.app,
          t('promptManager.deleteConfirm', { name: template.name }),
        );
        if (confirmed) {
          await this.aggregator.delete(template);
          this.renderList();
        }
      });
    } else if (template.source === 'agent') {
      const editBtn = cardActions.createEl('button', {
        cls: 'claudian-settings-action-btn',
        attr: { 'aria-label': t('common.edit') },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditor(template);
      });
    }
  }

  private applyToChat(template: PromptTemplate): void {
    const views = this.plugin.getAllViews();
    if (views.length === 0) return;

    const view = views[0];
    const tabManager = view.getTabManager();
    if (!tabManager) return;

    const activeTab = tabManager.getActiveTab();
    if (!activeTab) return;

    activeTab.dom.inputEl.value = template.content;
    activeTab.dom.inputEl.focus();
    activeTab.dom.inputEl.dispatchEvent(new Event('input'));

    this.aggregator.recordUsage(template.id);
    new Notice(t('promptManager.applied', { name: template.name }));
  }

  private duplicatePrompt(template: PromptTemplate): void {
    const duplicate: PromptTemplate = {
      ...template,
      id: '',
      name: `${template.name} (copy)`,
      _slashCommand: undefined,
    };
    this.openEditor(duplicate, true);
  }

  private openEditor(template: PromptTemplate | null, isDuplicate = false): void {
    const isReadOnly = template?.source === 'agent';
    const modal = new PromptEditModal(
      this.plugin.app,
      this.plugin,
      isDuplicate ? null : template,
      async (saved) => {
        await this.aggregator.save(saved);
        this.renderList();
      },
      {
        readOnly: isReadOnly,
        prefill: isDuplicate ? template ?? undefined : undefined,
      },
    );
    modal.open();
  }
}
