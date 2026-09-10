import { normalizeSchemaManifest } from './app-data-sql.util';
import type { AppDataSchemaManifest } from '../constants/app-data.types';

const tasksTable = {
  columns: {
    id: { type: 'uuid', primaryKey: true },
    title: { type: 'text' },
  },
};

describe('normalizeSchemaManifest', () => {
  it('returns the original manifest untouched when it already has the expected shape', () => {
    const manifest = {
      version: 1,
      tables: { tasks: tasksTable },
    } as AppDataSchemaManifest;

    const result = normalizeSchemaManifest(manifest);
    expect(result.changed).toBe(false);
    expect(result.manifest).toBe(manifest);
  });

  it('drops a numeric version key nested inside tables and keeps manifest-level version', () => {
    const manifest = {
      version: 1,
      tables: { tasks: tasksTable, version: 1 },
    } as unknown as AppDataSchemaManifest;

    const result = normalizeSchemaManifest(manifest);
    expect(result.changed).toBe(true);
    expect(result.manifest.version).toBe(1);
    expect(Object.keys(result.manifest.tables)).toEqual(['tasks']);
    expect(result.manifest.tables.tasks).toEqual(tasksTable);
  });

  it('promotes tables.version to the manifest level when the manifest-level version is missing', () => {
    const manifest = {
      tables: { tasks: tasksTable, version: 3 },
    } as unknown as AppDataSchemaManifest;

    const result = normalizeSchemaManifest(manifest);
    expect(result.changed).toBe(true);
    expect(result.manifest.version).toBe(3);
    expect(Object.keys(result.manifest.tables)).toEqual(['tasks']);
  });

  it('drops non-object table entries so validateManifest only judges real tables', () => {
    const manifest = {
      version: 2,
      tables: { tasks: tasksTable, broken: null, alsoBroken: 'nope' },
    } as unknown as AppDataSchemaManifest;

    const result = normalizeSchemaManifest(manifest);
    expect(result.changed).toBe(true);
    expect(Object.keys(result.manifest.tables)).toEqual(['tasks']);
  });

  it('passes through a manifest without tables or with a non-object tables value', () => {
    const noTables = { version: 1 } as unknown as AppDataSchemaManifest;
    expect(normalizeSchemaManifest(noTables)).toEqual({ manifest: noTables, changed: false });

    const badTables = { version: 1, tables: 'tasks' } as unknown as AppDataSchemaManifest;
    expect(normalizeSchemaManifest(badTables)).toEqual({ manifest: badTables, changed: false });

    expect(normalizeSchemaManifest(null as unknown as AppDataSchemaManifest)).toEqual({
      manifest: null,
      changed: false,
    });
  });
});
