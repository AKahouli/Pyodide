import { describe, expect, it } from 'vitest';
import { applyChunksToComponents } from './store';

describe('conversation streaming component updates', () => {
  it('retains tool arguments after a terminal status update', () => {
    const components = applyChunksToComponents([], [
      {
        action: 'add',
        component: {
          id: 'tool-call-1',
          type: 'toolInfo',
          data: { title: 'search_documents', status: 'running', params: '{"query":"contract"}' },
        },
      },
      {
        action: 'update',
        component: {
          id: 'tool-call-1',
          type: 'toolInfo',
          data: { title: 'search_documents', status: 'completed', params: '' },
        },
      },
    ] as never);

    expect(components).toEqual([
      {
        id: 'tool-call-1',
        type: 'toolInfo',
        data: { title: 'search_documents', status: 'completed', params: '{"query":"contract"}' },
      },
    ]);
  });
});
