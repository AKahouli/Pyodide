// Relative imports: the scripts run under ts-node without path aliases.
const queries: string[] = [];
const orphanCounts: Record<string, number> = {};

jest.mock('pg', () => ({
  Client: class {
    connect = async () => undefined;
    end = async () => undefined;
    query = async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT pg_get_constraintdef')) return { rows: [], rowCount: 0 };
      const orphan = Object.keys(orphanCounts).find((name) => sql.includes(`/*${name}*/`));
      if (orphan && sql.includes('count(*)')) return { rows: [{ n: orphanCounts[orphan] }], rowCount: 1 };
      if (sql.includes('/*select*/')) return { rows: [{ id: 'x' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
  },
}));

import { runFkSpecs, type FkSpec } from '../../../scripts/migrate/fk-helper';

const spec = (name: string): FkSpec => ({
  name,
  table: 'public.child',
  definition: 'FOREIGN KEY (parent_id) REFERENCES public.parent(id)',
  orphanCheck: `SELECT count(*)::int AS n FROM public.child /*${name}*/`,
  cleanup: { exportStem: name, selectSql: `SELECT id FROM public.child /*select*/ /*${name}*/`, deleteSql: `DELETE FROM public.child /*${name}*/` },
});

describe('runFkSpecs --keep-orphans', () => {
  const argv = process.argv;
  let log: jest.SpyInstance;
  beforeEach(() => {
    queries.length = 0;
    orphanCounts['fk_keep'] = 3;
    orphanCounts['fk_clear'] = 2;
    process.exitCode = undefined;
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(require('fs'), 'writeFileSync').mockImplementation(() => undefined);
    jest.spyOn(require('fs'), 'mkdirSync').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it('deletes the dangling rows of every spec but the kept one', async () => {
    process.argv = [...argv.slice(0, 2), '--delete-orphans', '--keep-orphans=fk_keep'];
    await runFkSpecs([spec('fk_keep'), spec('fk_clear')]);
    expect(queries.some((q) => q.startsWith('DELETE') && q.includes('/*fk_clear*/'))).toBe(true);
    expect(queries.some((q) => q.startsWith('DELETE') && q.includes('/*fk_keep*/'))).toBe(false);
    expect(log.mock.calls.flat().join('\n')).toContain('fk_keep: 3 orphan refs kept on purpose');
  });

  it('leaves the kept constraint NOT VALID and fails the run so nobody mistakes it for done', async () => {
    process.argv = [...argv.slice(0, 2), '--delete-orphans', '--keep-orphans=fk_keep'];
    await runFkSpecs([spec('fk_keep')]);
    expect(queries.some((q) => q.includes('VALIDATE CONSTRAINT fk_keep'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('refuses a name that matches no spec of the script', async () => {
    process.argv = [...argv.slice(0, 2), '--delete-orphans', '--keep-orphans=fk_typo'];
    await expect(runFkSpecs([spec('fk_keep')])).rejects.toThrow('no spec named fk_typo');
  });

  it('without the flag every spec is cleaned as before', async () => {
    process.argv = [...argv.slice(0, 2), '--delete-orphans'];
    await runFkSpecs([spec('fk_keep'), spec('fk_clear')]);
    expect(queries.some((q) => q.startsWith('DELETE') && q.includes('/*fk_keep*/'))).toBe(true);
  });
});
