import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '@modules/postgres/postgres.constants';
import type { AppDataEnvironment, AppDataPrincipal } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { assertIdentifier, quoteIdent } from '../utils/app-data-sql.util';
import { AppDataAuditService } from './app-data-audit.service';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataMigrationService } from './app-data-migration.service';
import { AppDataPolicyService } from './app-data-policy.service';

@Injectable()
export class AppDataRowService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly migrations: AppDataMigrationService,
    private readonly policies: AppDataPolicyService,
    private readonly audit: AppDataAuditService,
  ) {}

  private assertBodySize(body: Record<string, unknown>): void {
    const max = this.config.get<number>('appData.maxRowBodyBytes', 65_536);
    const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (size > max) {
      throw new AppDataException(AppDataErrorCode.LIMIT_EXCEEDED, `Row body exceeds ${max} bytes`);
    }
  }

  async insertRow(params: {
    appDataId: string;
    environment: AppDataEnvironment;
    table: string;
    row: Record<string, unknown>;
    principal: AppDataPrincipal;
    ownerUserId: string;
    skipPolicyCheck?: boolean;
  }) {
    this.assertBodySize(params.row);
    assertIdentifier(params.table, 'table name');
    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    const env = await this.catalog.getEnvironment(app.id, params.environment);
    if (!env?.provisionedAt) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not provisioned');
    }
    const policyDoc = await this.policies.getPolicies(app.workspaceId, params.environment);
    if (!params.skipPolicyCheck) {
      this.policies.assertAllowed(policyDoc[params.table], 'insert', params.principal, params.table);
    }

    const manifest = await this.migrations.getCurrentManifest(app.id, params.environment);
    const tableDef = manifest.tables[params.table];
    if (!tableDef) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown table: ${params.table}`);
    }

    const expectedCols = Object.keys(tableDef.columns);
    const cols: string[] = [];
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [col, val] of Object.entries(params.row)) {
      assertIdentifier(col, 'column name');
      if (!(col in tableDef.columns)) {
        throw new AppDataException(
          AppDataErrorCode.INVALID_MANIFEST,
          `Unknown column "${col}". Expected one of: ${expectedCols.join(', ')}`,
        );
      }
      cols.push(quoteIdent(col));
      placeholders.push(`$${idx++}`);
      values.push(val);
    }
    if (cols.length === 0) {
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        `Row body is empty — received keys: [${Object.keys(params.row).join(', ') || 'none'}]. ` +
          `Expected columns: [${expectedCols.join(', ')}]. ` +
          'Ensure the fetch sets Content-Type: application/json and the body contains column keys matching the schema.',
      );
    }

    const schemaQ = quoteIdent(env.schemaName);
    const tableQ = quoteIdent(params.table);
    const sql = `INSERT INTO ${schemaQ}.${tableQ} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;

    const client = await this.pool.connect();
    try {
      const timeoutMs = this.config.get<number>('appData.statementTimeoutMs', 30_000);
      await client.query('SET statement_timeout = $1', [timeoutMs]);
      const result = await client.query(sql, values);
      return result.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  /**
   * Batch-insert multiple rows into the same table in a single statement.
   * Rows carrying an explicit `id` that already exists are skipped
   * (ON CONFLICT DO NOTHING) — idempotent for re-seeds.
   */
  async batchInsert(params: {
    appDataId: string;
    environment: AppDataEnvironment;
    table: string;
    rows: Record<string, unknown>[];
    principal: AppDataPrincipal;
    ownerUserId: string;
  }): Promise<{ inserted: number; skipped: number }> {
    assertIdentifier(params.table, 'table name');
    if (params.rows.length === 0) return { inserted: 0, skipped: 0 };

    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    const env = await this.catalog.getEnvironment(app.id, params.environment);
    if (!env?.provisionedAt) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not provisioned');
    }
    const policyDoc = await this.policies.getPolicies(app.workspaceId, params.environment);
    this.policies.assertAllowed(policyDoc[params.table], 'insert', params.principal, params.table);

    const manifest = await this.migrations.getCurrentManifest(app.id, params.environment);
    const tableDef = manifest.tables[params.table];
    if (!tableDef) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown table: ${params.table}`);
    }

    const expectedCols = Object.keys(tableDef.columns);
    const schemaQ = quoteIdent(env.schemaName);
    const tableQ = quoteIdent(params.table);

    // Collect all distinct column names across all rows.
    const allCols = new Set<string>();
    for (const row of params.rows) {
      for (const col of Object.keys(row)) {
        assertIdentifier(col, 'column name');
        if (!(col in tableDef.columns)) {
          throw new AppDataException(
            AppDataErrorCode.INVALID_MANIFEST,
            `Unknown column "${col}". Expected one of: ${expectedCols.join(', ')}`,
          );
        }
        allCols.add(col);
      }
    }
    const colList = [...allCols];
    if (colList.length === 0) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, 'All rows are empty');
    }
    const colIdentifiers = colList.map(quoteIdent);

    // Build a multi-row INSERT with ON CONFLICT DO NOTHING.
    // Each row gets its own set of placeholders ($1, $2, ...).
    const valueClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const row of params.rows) {
      const placeholders = colList.map((col) => {
        const val = row[col];
        if (val === undefined) {
          values.push(null);
        } else {
          values.push(val);
        }
        return `$${idx++}`;
      });
      valueClauses.push(`(${placeholders.join(', ')})`);
    }

    const sql =
      `INSERT INTO ${schemaQ}.${tableQ} (${colIdentifiers.join(', ')}) ` +
      `VALUES ${valueClauses.join(', ')} ON CONFLICT DO NOTHING`;

    const client = await this.pool.connect();
    try {
      const timeoutMs = this.config.get<number>('appData.statementTimeoutMs', 30_000);
      await client.query('SET statement_timeout = $1', [timeoutMs]);
      const result = await client.query(sql, values);
      const inserted = result.rowCount ?? 0;
      const skipped = params.rows.length - inserted;
      return { inserted, skipped };
    } finally {
      client.release();
    }
  }

  async updateRow(params: {
    appDataId: string;
    environment: AppDataEnvironment;
    table: string;
    id: string;
    idColumn?: string;
    patch: Record<string, unknown>;
    principal: AppDataPrincipal;
    ownerUserId: string;
    skipPolicyCheck?: boolean;
  }) {
    this.assertBodySize(params.patch);
    const idColumn = params.idColumn ?? 'id';
    assertIdentifier(params.table, 'table name');
    assertIdentifier(idColumn, 'id column');

    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    const env = await this.catalog.getEnvironment(app.id, params.environment);
    if (!env?.provisionedAt) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not provisioned');
    }
    const policyDoc = await this.policies.getPolicies(app.workspaceId, params.environment);
    if (!params.skipPolicyCheck) {
      this.policies.assertAllowed(policyDoc[params.table], 'update', params.principal, params.table);
    }

    const manifest = await this.migrations.getCurrentManifest(app.id, params.environment);
    const tableDef = manifest.tables[params.table];
    if (!tableDef) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown table: ${params.table}`);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [col, val] of Object.entries(params.patch)) {
      assertIdentifier(col, 'column name');
      if (!(col in tableDef.columns)) {
        throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown column: ${col}`);
      }
      sets.push(`${quoteIdent(col)} = $${idx++}`);
      values.push(val);
    }
    if (sets.length === 0) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, 'Patch must include at least one column');
    }
    values.push(params.id);

    const schemaQ = quoteIdent(env.schemaName);
    const tableQ = quoteIdent(params.table);
    const sql = `UPDATE ${schemaQ}.${tableQ} SET ${sets.join(', ')} WHERE ${quoteIdent(idColumn)} = $${idx} RETURNING *`;

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, values);
      if (!result.rows[0]) {
        throw new AppDataException(AppDataErrorCode.ROW_NOT_FOUND, 'Row not found');
      }
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async deleteRow(params: {
    appDataId: string;
    environment: AppDataEnvironment;
    table: string;
    id: string;
    idColumn?: string;
    principal: AppDataPrincipal;
    ownerUserId: string;
    skipPolicyCheck?: boolean;
  }) {
    const idColumn = params.idColumn ?? 'id';
    assertIdentifier(params.table, 'table name');
    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    const env = await this.catalog.getEnvironment(app.id, params.environment);
    if (!env?.provisionedAt) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not provisioned');
    }
    const policyDoc = await this.policies.getPolicies(app.workspaceId, params.environment);
    if (!params.skipPolicyCheck) {
      this.policies.assertAllowed(policyDoc[params.table], 'delete', params.principal, params.table);
    }

    const schemaQ = quoteIdent(env.schemaName);
    const tableQ = quoteIdent(params.table);
    const sql = `DELETE FROM ${schemaQ}.${tableQ} WHERE ${quoteIdent(idColumn)} = $1 RETURNING *`;
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, [params.id]);
      if (!result.rows[0]) {
        throw new AppDataException(AppDataErrorCode.ROW_NOT_FOUND, 'Row not found');
      }
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Sample rows from a table. This bypasses policy checks for diagnostic
   * purposes (MCP tool: table_sample). The caller must explicitly opt in
   * via skipPolicyCheck=true and the principal is recorded in the audit log.
   */
  async sampleTable(params: {
    workspaceId: string;
    table: string;
    limit?: number;
    principal?: AppDataPrincipal;
    skipPolicyCheck?: boolean;
  }) {
    const app = await this.catalog.requireAppByWorkspace(params.workspaceId);
    const env = await this.catalog.getEnvironment(app.id, 'dev');
    if (!env?.provisionedAt) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not provisioned');
    }
    assertIdentifier(params.table, 'table name');
    const limit = Math.min(params.limit ?? 5, 20);

    await this.audit.record({
      appId: app.id,
      eventType: 'table_sample',
      actorPrincipal: params.principal ?? 'anonymous',
      metadata: { table: params.table, limit, skipPolicyCheck: params.skipPolicyCheck },
    });

    const schemaQ = quoteIdent(env.schemaName);
    const tableQ = quoteIdent(params.table);
    const sql = `SELECT * FROM ${schemaQ}.${tableQ} LIMIT $1`;
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, [limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }
}
