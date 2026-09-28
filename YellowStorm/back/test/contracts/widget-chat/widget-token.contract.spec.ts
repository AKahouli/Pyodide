import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { expectContract } from '../expect-contract';
import { toWire, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { WidgetChatService } from '@modules/widget-chat/services/widget-chat.service';
import { PgWidgetTokenStore, PgWidgetSessionStore, PgWidgetMessageStore } from '../../../src/modules/widget-chat/persistence/pg-widget.store';
import {
  InMemoryWidgetTokenStore,
  InMemoryWidgetSessionStore,
  InMemoryWidgetMessageStore,
} from '@modules/widget-chat/persistence/widget.store.fake';

const AGENT = '64b000000000000000000d01';
const USER = '64b000000000000000000001';

function makeService() {
  const tokenStore = new InMemoryWidgetTokenStore();
  const tokenStoreTyped = tokenStore as unknown as PgWidgetTokenStore;
  const service = new WidgetChatService(
    tokenStoreTyped,
    new InMemoryWidgetSessionStore() as unknown as PgWidgetSessionStore,
    new InMemoryWidgetMessageStore() as unknown as PgWidgetMessageStore,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn() } as never,
    { setContext: jest.fn(), log: jest.fn(), debug: jest.fn() } as never,
  );
  return { service, tokenStore };
}

describe('widget token contracts', () => {
  it('createToken returns the raw token once and never the hash', async () => {
    const { service, tokenStore } = makeService();
    const body = toWire(await service.createToken(AGENT, USER, { label: 'Site', allowedOrigins: ['https://example.test'] }));
    expectContract('widget-chat/token-created', body);
    expect(body.agentId).toBe(AGENT);
    expect(typeof body.token).toBe('string');
    expectNoKeys(body, 'tokenHash');
    // the stored hash is the sha256 of the returned token but is not on the wire
    expect(tokenStore.rows[0].tokenHash).toBe(createHash('sha256').update(body.token).digest('hex'));
    expect(JSON.stringify(body)).not.toContain(tokenStore.rows[0].tokenHash);
    expectNoMongoKeys(body);
  });

  it('listTokens / updateToken / revokeToken strip tokenHash', async () => {
    const { service, tokenStore } = makeService();
    const row = tokenStore.seed({ agentId: AGENT, label: 'Site', tokenHash: 'HASH-VALUE', createdBy: USER, expiresAt: new Date('2027-01-01T00:00:00Z'), lastUsedAt: new Date('2026-01-01T00:00:00Z') });
    const list = toWire<any[]>(await service.listTokens(AGENT));
    expectContract('widget-chat/token-view', list[0]);
    expect(list[0].id).toBe(row.id);
    const updated = toWire(await service.updateToken(AGENT, row.id, { label: 'Renamed' }));
    expectContract('widget-chat/token-view', updated);
    const revoked = toWire(await service.revokeToken(AGENT, row.id));
    expectContract('widget-chat/token-view', revoked);
    for (const b of [list, updated, revoked]) {
      expectNoKeys(b, 'tokenHash');
      expect(JSON.stringify(b)).not.toContain('HASH-VALUE');
      expectNoMongoKeys(b);
    }
  });
});
