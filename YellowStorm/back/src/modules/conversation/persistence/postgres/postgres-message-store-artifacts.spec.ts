import { PostgresMessageStore } from './postgres-message-store';
import { inspect } from 'util';

describe('PostgresMessageStore recent artifacts', () => {
  it('excludes platform copilot conversations', async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy });
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });
    const store = new PostgresMessageStore({ select } as never);

    await store.listRecentArtifactMessages('user-1', 6);

    const condition = where.mock.calls[0][0];
    expect(inspect(condition, { depth: 12 })).toContain('platform_copilot');
  });
});
