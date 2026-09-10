import {
  APP_DATA_COLUMN_TYPES,
  APP_DATA_IDENTIFIER_RE,
  APP_DATA_ID_RE,
  APP_DATA_TENANT_PREFIX,
  type AppDataColumnType,
  type AppDataEnvironment,
} from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type {
  AppDataColumnDef,
  AppDataSchemaManifest,
  AppDataTableDef,
} from '../constants/app-data.types';

/** Double-quote a validated PostgreSQL identifier. */
export function quoteIdent(name: string): string {
  assertIdentifier(name);
  return `"${name.replace(/"/g, '""')}"`;
}

export function assertIdentifier(name: string, label = 'identifier'): void {
  if (!APP_DATA_IDENTIFIER_RE.test(name)) {
    throw new AppDataException(
      AppDataErrorCode.INVALID_IDENTIFIER,
      `Invalid ${label}: ${name}`,
    );
  }
}

export function assertAppDataId(appDataId: string): void {
  if (!APP_DATA_ID_RE.test(appDataId)) {
    throw new AppDataException(
      AppDataErrorCode.INVALID_IDENTIFIER,
      `Invalid appDataId: ${appDataId}`,
    );
  }
}

export function tenantSchemaName(appDataId: string, environment: AppDataEnvironment): string {
  assertAppDataId(appDataId);
  const schema = `${APP_DATA_TENANT_PREFIX}${appDataId}_${environment}`;
  if (schema.length > 63) {
    throw new AppDataException(
      AppDataErrorCode.INVALID_IDENTIFIER,
      `Schema name exceeds PostgreSQL limit: ${schema}`,
    );
  }
  return schema;
}

export function pgTypeForColumn(type: AppDataColumnType): string {
  switch (type) {
    case 'text':
      return 'text';
    case 'integer':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'timestamptz':
      return 'timestamptz';
    case 'uuid':
      return 'uuid';
    default:
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        `Unsupported column type: ${String(type)}`,
      );
  }
}

export function formatDefault(def: AppDataColumnDef): string | null {
  if (def.default === undefined) return null;
  if (def.default === null) return 'NULL';
  if (typeof def.default === 'boolean') return def.default ? 'TRUE' : 'FALSE';
  if (typeof def.default === 'number') return String(def.default);
  return `'${String(def.default).replace(/'/g, "''")}'`;
}

export function validateManifest(
  manifest: AppDataSchemaManifest,
  limits: { maxTables: number; maxColumns: number },
): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, 'Manifest must be an object');
  }
  if (typeof manifest.version !== 'number' || manifest.version < 0) {
    throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, 'Invalid manifest.version');
  }
  const tables = manifest.tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, 'manifest.tables must be an object');
  }
  const tableNames = Object.keys(tables);
  if (tableNames.length > limits.maxTables) {
    throw new AppDataException(
      AppDataErrorCode.LIMIT_EXCEEDED,
      `Too many tables (max ${limits.maxTables})`,
    );
  }
  for (const tableName of tableNames) {
    assertIdentifier(tableName, 'table name');
    const table = tables[tableName] as AppDataTableDef;
    if (!table?.columns || typeof table.columns !== 'object') {
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        `Table ${tableName} must define columns`,
      );
    }
    const columnNames = Object.keys(table.columns);
    if (columnNames.length === 0) {
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        `Table ${tableName} must have at least one column`,
      );
    }
    if (columnNames.length > limits.maxColumns) {
      throw new AppDataException(
        AppDataErrorCode.LIMIT_EXCEEDED,
        `Too many columns on ${tableName} (max ${limits.maxColumns})`,
      );
    }
    let pkCount = 0;
    for (const colName of columnNames) {
      assertIdentifier(colName, 'column name');
      const col = table.columns[colName];
      if (!APP_DATA_COLUMN_TYPES.includes(col.type)) {
        throw new AppDataException(
          AppDataErrorCode.INVALID_MANIFEST,
          `Invalid type on ${tableName}.${colName}`,
        );
      }
      if (col.primaryKey) pkCount += 1;
    }
    if (pkCount > 1) {
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        `Table ${tableName} supports at most one primaryKey column in MVP`,
      );
    }
  }
}

/**
 * Repair common LLM mistakes in an MCP-submitted manifest instead of failing
 * the whole tool call: a numeric `version` key nested inside `tables` is
 * promoted to the manifest level (when missing there) and dropped either way,
 * and non-object table entries are discarded so `validateManifest` judges
 * only the real tables. Returns the original reference untouched when the
 * manifest already has the expected shape.
 */
export function normalizeSchemaManifest(
  manifest: AppDataSchemaManifest,
): { manifest: AppDataSchemaManifest; changed: boolean } {
  if (!manifest || typeof manifest !== 'object') {
    return { manifest, changed: false };
  }
  const rawTables: unknown = manifest.tables;
  if (!rawTables || typeof rawTables !== 'object' || Array.isArray(rawTables)) {
    return { manifest, changed: false };
  }

  let version = manifest.version;
  let changed = false;
  const tables: Record<string, AppDataTableDef> = {};

  for (const [tableName, tableDef] of Object.entries(rawTables as Record<string, unknown>)) {
    if (tableName === 'version') {
      // Frequent LLM slip: the manifest-level version copied inside `tables`.
      if (typeof version !== 'number' && typeof tableDef === 'number') {
        version = tableDef;
      }
      changed = true;
      continue;
    }
    if (!tableDef || typeof tableDef !== 'object' || Array.isArray(tableDef)) {
      // Drop malformed entries; validateManifest reports whatever remains.
      changed = true;
      continue;
    }
    tables[tableName] = tableDef as AppDataTableDef;
  }

  if (!changed) {
    return { manifest, changed: false };
  }
  return { manifest: { version: version as number, tables }, changed: true };
}

export function advisoryLockKey(appDataId: string, environment: AppDataEnvironment): string {
  return `${appDataId}:${environment}`;
}
