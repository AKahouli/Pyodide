import { ServiceUnavailableException } from '@nestjs/common';
import { MemoryCardsService } from './memory-cards.service';

describe('MemoryCardsService', () => {
  const createService = () => {
    const query = jest.fn();
    const config = { get: jest.fn() };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const service = new MemoryCardsService(config as any, logger as any);
    // Inject a fake pool (bypass onModuleInit which reads env config).
    (service as any).pool = { query };
    return { service, query };
  };

  describe('findByAgent', () => {
    it('scopes the query by agent_id and normalises rows', async () => {
      const { service, query } = createService();
      // First call: COUNT(*), second call: the paginated rows.
      query
        .mockResolvedValueOnce({ rows: [{ total: 3 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              title: 'T',
              summary: 'S',
              content: 'C',
              type: 'fact',
              keywords: ['a', 'b'], // native array
              valid_from: new Date('2026-01-05T09:00:00Z'),
              valid_until: null,
              created_at: new Date('2026-01-05T09:00:00Z'),
              updated_at: new Date('2026-02-11T14:22:00Z'),
            },
            { id: 2, title: 't2', keywords: '{x,y}' }, // pg text-array form
            { id: 3, title: 't3', keywords: 'p, q' }, // comma-separated
          ],
        });

      const { memories: result, total } = await service.findByAgent('agent-1');

      // one count query + one select query, both scoped by agent_id
      expect(query).toHaveBeenCalledTimes(2);
      expect(total).toBe(3);
      const [countSql, countParams] = query.mock.calls[0];
      expect(countSql).toContain('COUNT(*)');
      expect(countSql).toContain('agent_id');
      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain('memory_cards_metadata');
      expect(sql).toContain('agent_id');
      expect(countParams).toEqual(['agent-1']);
      expect(params).toEqual(['agent-1']);

      // id coerced to string, dates -> ISO, null preserved
      expect(result[0].id).toBe('1');
      expect(result[0].keywords).toEqual(['a', 'b']);
      expect(result[0].valid_from).toBe('2026-01-05T09:00:00.000Z');
      expect(result[0].valid_until).toBeNull();
      expect(result[0].created_at).toBe('2026-01-05T09:00:00.000Z');

      // keyword normalisation from text forms
      expect(result[1].keywords).toEqual(['x', 'y']);
      expect(result[2].keywords).toEqual(['p', 'q']);

      // missing fields default to empty
      expect(result[1].summary).toBe('');
      expect(result[1].type).toBe('');
    });

    it('adds an ILIKE search filter and LIMIT/OFFSET when paginating', async () => {
      const { service, query } = createService();
      query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.findByAgent('agent-1', { search: 'hello', limit: 20, offset: 40 });

      const [countSql, countParams] = query.mock.calls[0];
      expect(countSql).toContain('ILIKE');
      expect(countParams).toEqual(['agent-1', '%hello%']);

      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain('ILIKE');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      // agent_id, search pattern, limit, offset
      expect(params).toEqual(['agent-1', '%hello%', 20, 40]);
    });

    it('throws ServiceUnavailable when the pool is not configured', async () => {
      const { service } = createService();
      (service as any).pool = null;
      await expect(service.findByAgent('agent-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('deleteMany', () => {
    it('returns 0 and issues no query for an empty id list', async () => {
      const { service, query } = createService();
      const deleted = await service.deleteMany('agent-1', []);
      expect(deleted).toBe(0);
      expect(query).not.toHaveBeenCalled();
    });

    it('scopes the delete by agent_id and ids, returning rowCount', async () => {
      const { service, query } = createService();
      query.mockResolvedValue({ rowCount: 2 });

      const deleted = await service.deleteMany('agent-1', ['m1', 'm2']);

      expect(deleted).toBe(2);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('DELETE FROM memory_cards_metadata');
      expect(sql).toContain('agent_id');
      expect(sql).toContain('ANY');
      expect(params).toEqual(['agent-1', ['m1', 'm2']]);
    });
  });
});
