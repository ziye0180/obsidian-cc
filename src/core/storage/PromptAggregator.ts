/**
 * Aggregation layer for prompt templates.
 *
 * Unifies slash commands, skills, agents, and system prompts into a
 * single PromptTemplate view model. Delegates storage to existing managers.
 */

import type ClaudianPlugin from '../../main';
import { isSkill } from '../../utils/slashCommand';
import type { SlashCommand } from '../types';
import type { PromptFilterOptions, PromptTemplate, PromptUsageStats } from '../types/prompts';

export class PromptAggregator {
  private plugin: ClaudianPlugin;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  getAll(): PromptTemplate[] {
    return [
      ...this.fromSlashCommands(),
      ...this.fromAgents(),
      ...this.fromSystemPrompts(),
    ];
  }

  filter(options: PromptFilterOptions): PromptTemplate[] {
    let results = this.getAll();

    if (options.source) {
      results = results.filter(t => t.source === options.source);
    }

    if (options.category) {
      results = results.filter(t => t.category === options.category);
    }

    if (options.pinnedOnly) {
      results = results.filter(t => t.pinned);
    }

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.content.toLowerCase().includes(q) ||
        t.tags?.some(tag => tag.toLowerCase().includes(q))
      );
    }

    return results;
  }

  async save(template: PromptTemplate): Promise<void> {
    if (template.source === 'command' || template.source === 'skill') {
      await this.saveAsSlashCommand(template);
    }
    // Agents and system prompts are read-only from this layer
  }

  async delete(template: PromptTemplate): Promise<void> {
    if (template.source === 'command' || template.source === 'skill') {
      const cmd = template._slashCommand;
      if (cmd) {
        if (isSkill(cmd)) {
          await this.plugin.storage.skills.delete(cmd.id);
        } else {
          await this.plugin.storage.commands.delete(cmd.id);
        }
        this.plugin.settings.slashCommands =
          this.plugin.settings.slashCommands.filter(c => c.id !== cmd.id);
      }
    }
  }

  recordUsage(id: string): void {
    const stats = this.plugin.settings.promptUsageStats ?? {};
    const existing = stats[id] ?? { lastUsedAt: 0, useCount: 0 };
    stats[id] = {
      lastUsedAt: Date.now(),
      useCount: existing.useCount + 1,
    };
    this.plugin.settings.promptUsageStats = stats;
    this.plugin.saveSettings();
  }

  private fromSlashCommands(): PromptTemplate[] {
    const stats = this.plugin.settings.promptUsageStats ?? {};

    return this.plugin.settings.slashCommands.map(cmd => {
      const source = isSkill(cmd) ? 'skill' as const : 'command' as const;
      const usage = stats[cmd.id] as PromptUsageStats | undefined;

      return {
        id: cmd.id,
        name: cmd.name,
        description: cmd.description,
        content: cmd.content,
        source,
        category: cmd.category,
        tags: cmd.tags,
        allowedTools: cmd.allowedTools,
        model: cmd.model,
        argumentHint: cmd.argumentHint,
        pinned: cmd.pinned,
        lastUsedAt: usage?.lastUsedAt,
        useCount: usage?.useCount,
        _slashCommand: cmd,
      };
    });
  }

  private fromAgents(): PromptTemplate[] {
    const agents = this.plugin.agentManager.getAvailableAgents();
    const stats = this.plugin.settings.promptUsageStats ?? {};

    return agents
      .filter(a => a.source !== 'builtin')
      .map(agent => {
        const id = `agent-${agent.id}`;
        const usage = stats[id] as PromptUsageStats | undefined;

        return {
          id,
          name: agent.name,
          description: agent.description,
          content: agent.prompt,
          source: 'agent' as const,
          model: agent.model,
          lastUsedAt: usage?.lastUsedAt,
          useCount: usage?.useCount,
          _agentDefinition: agent,
        };
      });
  }

  private fromSystemPrompts(): PromptTemplate[] {
    const systemPrompt = this.plugin.settings.systemPrompt?.trim();
    if (!systemPrompt) return [];

    return [{
      id: 'sys-main',
      name: 'System Prompt',
      description: 'Main system prompt for all conversations',
      content: systemPrompt,
      source: 'system',
    }];
  }

  private async saveAsSlashCommand(template: PromptTemplate): Promise<void> {
    const existing = this.plugin.settings.slashCommands.find(c => c.id === template.id);

    const cmd: SlashCommand = {
      id: template.id || `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name: template.name,
      description: template.description,
      argumentHint: template.argumentHint,
      allowedTools: template.allowedTools,
      model: template.model as SlashCommand['model'],
      content: template.content,
      source: template.source === 'skill' ? 'user' : undefined,
    };

    const isSkillType = template.source === 'skill';
    if (isSkillType) {
      await this.plugin.storage.skills.save(cmd);
    } else {
      await this.plugin.storage.commands.save(cmd);
    }

    if (existing) {
      const idx = this.plugin.settings.slashCommands.indexOf(existing);
      if (idx !== -1) {
        this.plugin.settings.slashCommands[idx] = cmd;
      }
    } else {
      this.plugin.settings.slashCommands.push(cmd);
    }
  }
}
