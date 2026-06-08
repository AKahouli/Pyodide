import type { PlaybookIntentSuggestion } from '../services/playbook-flow-intent.service';

export type PlaybookIntentConstructionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type PlaybookIntentConstructionEvent =
  | { type: 'started'; constructionId: string; playbookId: string; sequence: number; createdAt: string; model: string; baseDefinitionRevision: number }
  | { type: 'progress'; constructionId: string; playbookId: string; sequence: number; createdAt: string; phase: 'planning' | 'generating_node' | 'generating_edges' | 'generating_bindings' | 'completed'; message: string; current?: number; total?: number }
  | { type: 'node_delta'; constructionId: string; playbookId: string; sequence: number; createdAt: string; suggestion: PlaybookIntentSuggestion; nodeRef?: string; nodeIndex?: number; totalNodes?: number }
  | { type: 'edge_delta'; constructionId: string; playbookId: string; sequence: number; createdAt: string; suggestion: PlaybookIntentSuggestion }
  | { type: 'data_binding_delta'; constructionId: string; playbookId: string; sequence: number; createdAt: string; suggestion: PlaybookIntentSuggestion }
  | { type: 'completed'; constructionId: string; playbookId: string; sequence: number; createdAt: string; model: string; finalSuggestionCount: number }
  | { type: 'failed'; constructionId: string; playbookId: string; sequence: number; createdAt: string; message: string; recoverable: boolean }
  | { type: 'cancelled'; constructionId: string; playbookId: string; sequence: number; createdAt: string; reason?: string };

export interface PlaybookIntentConstructionStartResult {
  constructionId: string;
  playbookId: string;
  baseDefinitionRevision: number;
}
