import { getTableConfig } from 'drizzle-orm/pg-core';
import { evaluationResults, evaluationRuns } from './evaluation.schema';

describe('evaluation postgres schema', () => {
  it('keeps owned tables in the evaluation schema', () => {
    for (const table of [evaluationRuns, evaluationResults]) {
      expect(getTableConfig(table).schema).toBe('evaluation');
    }
  });

  it('cascades result deletion from the owning run', () => {
    const fks = getTableConfig(evaluationResults).foreignKeys;
    expect(fks).toHaveLength(1);
    expect(fks[0].onDelete).toBe('cascade');
  });

  it('deduplicates per-query results with a unique (evaluation_id, query_id) index', () => {
    const indexes = getTableConfig(evaluationResults).indexes;
    const dup = indexes.find((item) => item.config.name === 'idx_lser_evaluation_query');
    const columnNames = (dup?.config.columns as { name: string }[]).map((col) => col.name);
    expect(dup?.config.unique).toBe(true);
    expect(columnNames).toEqual(['evaluation_id', 'query_id']);
  });
});