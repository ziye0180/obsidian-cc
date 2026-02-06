/**
 * Prompt template types for the prompt aggregation layer.
 */

import type { AgentDefinition } from './agent';
import type { SlashCommand } from './settings';

export type PromptCategory = 'general' | 'coding' | 'writing' | 'analysis' | 'workflow' | 'custom';

export type PromptSource = 'command' | 'skill' | 'agent' | 'system';

/** Unified view model for all prompt sources. */
export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  content: string;
  source: PromptSource;
  category?: PromptCategory;
  tags?: string[];
  allowedTools?: string[];
  model?: string;
  argumentHint?: string;
  pinned?: boolean;
  lastUsedAt?: number;
  useCount?: number;
  _slashCommand?: SlashCommand;
  _agentDefinition?: AgentDefinition;
}

export interface PromptFilterOptions {
  query?: string;
  source?: PromptSource;
  category?: PromptCategory;
  pinnedOnly?: boolean;
}

export interface PromptUsageStats {
  lastUsedAt: number;
  useCount: number;
}
