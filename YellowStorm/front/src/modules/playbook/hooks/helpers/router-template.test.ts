import { describe, expect, it } from 'vitest';

import { cloneRouterConfig } from './router-template';

describe('cloneRouterConfig', () => {
  it('preserves deterministic router config fields from templates', () => {
    const routerConfig = cloneRouterConfig({
      outputLabels: ['retry', 'done'],
      maxIterations: 3,
      defaultLabel: 'done',
      mode: 'ai',
      prompt: 'Pick a route.',
      conditions: [{
        label: 'done',
        sourceNode: 'step-1',
        sourcePort: 'result',
        path: 'verdict',
        operator: 'equals',
        value: 'valid',
      }],
    });

    expect(routerConfig).toEqual({
      outputLabels: ['retry', 'done'],
      maxIterations: 3,
      defaultLabel: 'done',
      mode: 'ai',
      prompt: 'Pick a route.',
      conditions: [{
        label: 'done',
        sourceNode: 'step-1',
        sourcePort: 'result',
        path: 'verdict',
        operator: 'equals',
        value: 'valid',
      }],
    });
  });

  it('clones router config arrays so persistence edits do not mutate templates', () => {
    const source = {
      outputLabels: ['generate', 'human_review'],
      maxIterations: 2,
      defaultLabel: 'generate',
      conditions: [{ label: 'human_review', sourceNode: 'check', sourcePort: 'flag', operator: 'equals' as const, value: true }],
    };

    const routerConfig = cloneRouterConfig(source);
    routerConfig.outputLabels.push('fallback');
    routerConfig.conditions?.[0] && (routerConfig.conditions[0].label = 'generate');

    expect(source.outputLabels).toEqual(['generate', 'human_review']);
    expect(source.conditions[0].label).toBe('human_review');
  });
});
