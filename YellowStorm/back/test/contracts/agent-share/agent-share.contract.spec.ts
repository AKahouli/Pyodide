import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { AgentShareService } from '@modules/agent/services/agent-share.service';
import type { AgentShareRow } from '@modules/agent/persistence/agent-share.store';

const OWNER = '64b000000000000000000001';
const RECIPIENT = '64b000000000000000000002';
const AGENT = '64b000000000000000000b01';

const share: AgentShareRow = {
  id: '64b000000000000000000b02',
  agentId: AGENT,
  sharedBy: OWNER,
  sharedWith: RECIPIENT,
  permission: 'write',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const users = new Map([
  [OWNER, { id: OWNER, email: 'user-1@example.test', firstName: 'First', lastName: 'Owner' }],
  [RECIPIENT, { id: RECIPIENT, email: 'user-2@example.test', firstName: 'First', lastName: 'Recipient' }],
]);

function makeService(): AgentShareService {
  const store = {
    findByAgent: async () => [share],
    find: async () => share,
    listSharedWithUser: async () => [share],
    updatePermission: async () => share,
  };
  const userLookup = {
    byIds: async (ids: string[]) => new Map([...users].filter(([id]) => ids.includes(id))),
    byEmails: async () => new Map(),
    byId: async (id: string) => users.get(id) ?? null,
  };
  return new AgentShareService(store as never, userLookup as never, { setContext: jest.fn(), log: jest.fn() } as never);
}

describe('agent-share contracts', () => {
  it('owner-side share entries (populated recipient) match the fixture', async () => {
    const body = toWire<any[]>(await makeService().getAgentShares(AGENT));
    expectContract('agent-share/share-entry', body[0]);
    expect(body[0].shareId).toBe(share.id);
    expect(body[0].user).toEqual({ id: RECIPIENT, email: 'user-2@example.test', firstName: 'First', lastName: 'Recipient' });
    expectNoMongoKeys(body);
    expectNoKeys(body, 'sharedWith', 'sharedBy', 'agentId', 'updatedAt');
  });

  it('recipient-side shareInfo (populated sharedBy) matches the fixture', async () => {
    const body = toWire(await makeService().getShareInfo(RECIPIENT, AGENT));
    expectContract('agent-share/share-info', body);
    expect(body.shareId).toBe(share.id);
    expect(body.sharedBy.email).toBe('user-1@example.test');
    expectNoMongoKeys(body);
  });

  it('getShareInfoMapForUser yields the same shareInfo shape per agent', async () => {
    const map = await makeService().getShareInfoMapForUser(RECIPIENT);
    expectContract('agent-share/share-info', toWire(map.get(AGENT)));
  });

  it('updateSharePermission returns a share entry', async () => {
    const body = toWire(await makeService().updateSharePermission(AGENT, share.id, { permission: 'read' } as never));
    expectContract('agent-share/share-entry', body);
  });
});
