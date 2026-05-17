import { describe, expect, it } from 'vitest';

import { cloneRouterConfig } from './router-template';

describe('cloneRouterConfig', () => {
  it('preserves deterministic router config fields from templates', () => {
    const routerConfig = cloneRouterConfig({
      outputLabels: ['retry', 'done'],
      maxIterations: 3,
      defaultLabel: 'done',
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
});
