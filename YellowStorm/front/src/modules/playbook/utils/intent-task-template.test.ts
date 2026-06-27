import { describe, expect, it } from 'vitest';
import { isIntentIteratorTask } from './intent-task-template';
import type { PlaybookIntentTaskDraft, TaskTemplate } from '../types';

const baseTemplate = {
  id: 'template-1',
  key: 'generic-ai-task',
  type: 'generic-ai-task',
  nodeType: 'agent',
  title: 'Generic AI task',
  description: '',
  icon: 'FileText',
  color: 'blue',
  category: 'content',
  inputPorts: [],
  outputPorts: [],
  promptTemplate: '',
  recommendedAgentTypeSlug: null,
  requiredToolNames: [],
} satisfies TaskTemplate;

const iteratorBody = {
  steps: [{ nodeRef: 'child', title: 'Child', description: 'Child', nodeTemplateKey: 'generic-ai-task' }],
  edges: [],
} satisfies NonNullable<PlaybookIntentTaskDraft['iteratorBody']>;

describe('isIntentIteratorTask', () => {
  it('detects iterator templates by node type', () => {
    expect(isIntentIteratorTask({ ...baseTemplate, nodeType: 'iterator' }, undefined)).toBe(true);
  });

  it('detects iterator-capable templates by iterator config', () => {
    expect(isIntentIteratorTask({
      ...baseTemplate,
      iteratorConfig: {
        source: '{{items}}',
        mode: 'item',
        batchSize: 10,
        itemVariable: 'item',
        outputVariable: 'processed_items',
        errorStrategy: 'stop',
      },
    }, undefined)).toBe(true);
  });

  it('preserves iterator drafts even when the local template lookup is unavailable', () => {
    expect(isIntentIteratorTask(null, iteratorBody)).toBe(true);
  });

  it('keeps ordinary drafts generic when no iterator signal exists', () => {
    expect(isIntentIteratorTask(baseTemplate, { steps: [], edges: [] })).toBe(false);
  });
});
