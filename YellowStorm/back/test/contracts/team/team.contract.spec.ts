import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { TeamService } from '@modules/team/team.service';
import type { TeamRow } from '@modules/team/persistence/team.store';

const row: TeamRow = {
  id: '64b000000000000000000c01',
  name: 'Support squad',
  description: 'Handles support',
  isActive: true,
  createdBy: '64b000000000000000000001',
  members: [
    { agentId: '64b000000000000000000c12', parentAgentId: null, order: 0, positionX: 10, positionY: 20 },
    { agentId: '64b000000000000000000c11', parentAgentId: '64b000000000000000000c12', order: 1, positionX: 30, positionY: 40 },
    { agentId: '64b000000000000000000c10', parentAgentId: '64b000000000000000000c12', order: 2, positionX: 50, positionY: 60 },
  ],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('team response contract', () => {
  it('toResponse keeps members in store (position) order and matches the fixture', () => {
    const body = toWire(callPrivate(TeamService, 'toResponse', [row]));
    expectContract('team/team', body);
    expect(body.id).toBe(row.id);
    expect(body.agentCount).toBe(3);
    expect(body.members.map((m: { agentId: string }) => m.agentId)).toEqual(row.members.map((m) => m.agentId));
    expect(body.members.map((m: { order: number }) => m.order)).toEqual([0, 1, 2]);
    expect(body.members[0].parentAgentId).toBeNull();
    expectNoMongoKeys(body);
    expectNoKeys(body, 'agentIds');
  });

  it('toResponseWithAgents adds the resolved agent to each member', () => {
    const agentMap = new Map(row.members.map((m) => [m.agentId, { id: m.agentId, name: `Agent ${m.order}` }]));
    const body = toWire(callPrivate(TeamService, 'toResponseWithAgents', [row, agentMap]));
    expectContract('team/team-with-agents', body);
    expect(body.members[0].agent.name).toBe('Agent 0');
  });
});
