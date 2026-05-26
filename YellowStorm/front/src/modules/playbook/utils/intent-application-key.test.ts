import { describe, expect, it } from 'vitest';
import {
  createIntentSuggestionApplicationKey,
  createIntentSuggestionBindingId,
  createIntentSuggestionNodeId,
} from './intent-application-key';
import type { PlaybookIntentSuggestion } from '../types';

const workflowSuggestion: PlaybookIntentSuggestion = {
  id: 'intent-0',
  kind: 'workflow_plan',
  label: 'Add review stage',
  summary: 'Adds a review stage after drafting.',
  reason: 'Review catches obvious issues before final delivery.',
  confidence: 0.91,
  impact: {
    nodesToCreate: 1,
    nodesToUpdate: 0,
    nodesToDelete: 0,
    edgesToCreate: 1,
    edgesToDelete: 0,
    dataBindingsToCreate: 1,
    dataBindingsToDelete: 0,
    affectedTaskIds: ['draft-task'],
    businessOutcome: 'Improves quality control.',
  },
  changes: [
    {
      type: 'create_node',
      nodeRef: 'review',
      anchor: {
        mode: 'after',
        targetTaskId: 'draft-task',
        nodeRef: null,
      },
      task: {
        title: 'Review draft',
        description: 'Check the generated draft before publishing.',
      },
    },
  ],
  isDirectIntentFallback: false,
};

describe('intent application key helpers', () => {
  it('returns stable application keys for the same suggestion', () => {
    expect(createIntentSuggestionApplicationKey('playbook-1', workflowSuggestion))
      .toBe(createIntentSuggestionApplicationKey('playbook-1', workflowSuggestion));
  });

  it('derives stable node and binding ids from the application key', () => {
    const applicationKey = createIntentSuggestionApplicationKey('playbook-1', workflowSuggestion);

    expect(createIntentSuggestionNodeId(applicationKey, 'review'))
      .toBe(createIntentSuggestionNodeId(applicationKey, 'review'));
    expect(createIntentSuggestionBindingId(applicationKey, 'review-node', 'prompt', 'draft-node', 'text', 'current'))
      .toBe(createIntentSuggestionBindingId(applicationKey, 'review-node', 'prompt', 'draft-node', 'text', 'current'));
  });

  it('changes ids when the suggestion changes', () => {
    const original = createIntentSuggestionApplicationKey('playbook-1', workflowSuggestion);
    const changed = createIntentSuggestionApplicationKey('playbook-1', {
      ...workflowSuggestion,
      summary: 'Adds an approval stage after drafting.',
    });

    expect(changed).not.toBe(original);
  });
});
