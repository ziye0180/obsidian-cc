import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import type { PromptCategory, PromptSource, PromptTemplate } from '../../core/types/prompts';
import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n/types';
import type ClaudianPlugin from '../../main';

const CATEGORY_OPTIONS: { value: PromptCategory | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'promptManager.categories.none' },
  { value: 'general', labelKey: 'promptManager.categories.general' },
  { value: 'coding', labelKey: 'promptManager.categories.coding' },
  { value: 'writing', labelKey: 'promptManager.categories.writing' },
  { value: 'analysis', labelKey: 'promptManager.categories.analysis' },
  { value: 'workflow', labelKey: 'promptManager.categories.workflow' },
  { value: 'custom', labelKey: 'promptManager.categories.custom' },
];

export interface PromptEditModalOptions {
  readOnly?: boolean;
  prefill?: PromptTemplate;
}

export class PromptEditModal extends Modal {
  private plugin: ClaudianPlugin;
  private existingTemplate: PromptTemplate | null;
  private onSave: (template: PromptTemplate) => Promise<void>;
  private options: PromptEditModalOptions;

  constructor(
    app: App,
    plugin: ClaudianPlugin,
    existingTemplate: PromptTemplate | null,
    onSave: (template: PromptTemplate) => Promise<void>,
    options?: PromptEditModalOptions,
  ) {
    super(app);
    this.plugin = plugin;
    this.existingTemplate = existingTemplate;
    this.onSave = onSave;
    this.options = options ?? {};
  }

  onOpen(): void {
    const source = this.existingTemplate ?? this.options.prefill;
    const isNew = !this.existingTemplate;
    const isReadOnly = this.options.readOnly ?? false;

    this.setTitle(isReadOnly ? source?.name ?? 'Prompt' : (isNew ? t('promptManager.newTitle') : t('promptManager.editTitle')));
    this.modalEl.addClass('claudian-sp-modal');

    const { contentEl } = this;
    let nameInput: HTMLInputElement;
    let descInput: HTMLInputElement;
    let categoryValue: PromptCategory | '' = source?.category ?? '';
    let tagsInput: HTMLInputElement;
    let typeValue: PromptSource = source?.source ?? 'command';

    // Type selector (only for new prompts)
    if (isNew && !isReadOnly) {
      new Setting(contentEl)
        .setName(t('promptManager.fields.type'))
        .setDesc(t('promptManager.fields.typeDesc'))
        .addDropdown(dropdown => {
          dropdown.addOption('command', t('promptManager.source.command'));
          dropdown.addOption('skill', t('promptManager.source.skill'));
          dropdown.setValue(typeValue)
            .onChange(v => { typeValue = v as PromptSource; });
        });
    }

    new Setting(contentEl)
      .setName(t('promptManager.fields.name'))
      .setDesc(t('promptManager.fields.nameDesc'))
      .addText(text => {
        nameInput = text.inputEl;
        text.setValue(source?.name ?? '')
          .setPlaceholder(t('promptManager.fields.namePlaceholder'));
        if (isReadOnly) nameInput.disabled = true;
      });

    new Setting(contentEl)
      .setName(t('promptManager.fields.description'))
      .setDesc(t('promptManager.fields.descriptionDesc'))
      .addText(text => {
        descInput = text.inputEl;
        text.setValue(source?.description ?? '')
          .setPlaceholder(t('promptManager.fields.descriptionPlaceholder'));
        if (isReadOnly) descInput.disabled = true;
      });

    new Setting(contentEl)
      .setName(t('promptManager.fields.category'))
      .addDropdown(dropdown => {
        for (const opt of CATEGORY_OPTIONS) {
          dropdown.addOption(opt.value, t(opt.labelKey));
        }
        dropdown.setValue(categoryValue)
          .onChange(v => { categoryValue = v as PromptCategory | ''; });
        if (isReadOnly) dropdown.selectEl.disabled = true;
      });

    new Setting(contentEl)
      .setName(t('promptManager.fields.tags'))
      .setDesc(t('promptManager.fields.tagsDesc'))
      .addText(text => {
        tagsInput = text.inputEl;
        text.setValue(source?.tags?.join(', ') ?? '')
          .setPlaceholder(t('promptManager.fields.tagsPlaceholder'));
        if (isReadOnly) tagsInput.disabled = true;
      });

    const contentSetting = new Setting(contentEl)
      .setName(t('promptManager.fields.template'))
      .setDesc(t('promptManager.fields.templateDesc'));
    contentSetting.settingEl.addClass('claudian-sp-full-width');

    const contentArea = contentEl.createEl('textarea', {
      cls: 'claudian-sp-textarea',
    });
    contentArea.value = source?.content ?? '';
    contentArea.rows = 10;
    contentArea.placeholder = t('promptManager.fields.templatePlaceholder');
    if (isReadOnly) contentArea.disabled = true;

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'claudian-sp-buttons' });

    if (isReadOnly) {
      const closeBtn = buttonContainer.createEl('button', {
        text: t('promptManager.close'),
        cls: 'claudian-cancel-btn',
      });
      closeBtn.addEventListener('click', () => this.close());
    } else {
      const cancelBtn = buttonContainer.createEl('button', {
        text: t('common.cancel'),
        cls: 'claudian-cancel-btn',
      });
      cancelBtn.addEventListener('click', () => this.close());

      const saveBtn = buttonContainer.createEl('button', {
        text: t('common.save'),
        cls: 'claudian-save-btn',
      });
      saveBtn.addEventListener('click', async () => {
        const name = nameInput!.value.trim();
        if (!name) {
          new Notice(t('promptManager.validation.nameRequired'));
          return;
        }

        const content = contentArea.value.trim();
        if (!content) {
          new Notice(t('promptManager.validation.contentRequired'));
          return;
        }

        const tags = tagsInput!.value
          .split(',')
          .map(tg => tg.trim())
          .filter(Boolean);

        const template: PromptTemplate = {
          id: this.existingTemplate?.id ?? `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          name,
          description: descInput!.value.trim() || undefined,
          content,
          source: isNew ? typeValue : (this.existingTemplate?.source ?? 'command'),
          category: categoryValue || undefined,
          tags: tags.length > 0 ? tags : undefined,
          pinned: this.existingTemplate?.pinned,
          _slashCommand: this.existingTemplate?._slashCommand,
          _agentDefinition: this.existingTemplate?._agentDefinition,
        };

        try {
          await this.onSave(template);
          this.close();
        } catch {
          new Notice(t('promptManager.validation.saveFailed'));
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
