import { describe, expect, it } from 'vitest';
import { membersToNodes } from './useTeamCanvas';

describe('membersToNodes', () => {
  it('uses the agent type slug and null parent as the hierarchy behavior inputs', () => {
    const [root, leaf] = membersToNodes([
      {
        agentId: 'root', parentAgentId: null, order: 0, positionX: 0, positionY: 0,
        agent: { id: 'root', name: 'Root', agentType: { id: 'manager-type', name: 'Manager', slug: 'manager' }, role: '', description: '' },
      },
      {
        agentId: 'leaf', parentAgentId: 'root', order: 0, positionX: 0, positionY: 100,
        agent: { id: 'leaf', name: 'Leaf', agentType: { id: 'worker-type', name: 'Worker', slug: 'worker' }, role: '', description: '' },
      },
    ]);

    expect(root.data).toMatchObject({ parentAgentId: null, agentTypeSlug: 'manager' });
    expect(leaf.data).toMatchObject({ parentAgentId: 'root', agentTypeSlug: 'worker' });
  });
});
