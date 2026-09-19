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
import { APP_DATA_MAX_LIST_FILTERS, parsePositiveInt } from '../utils/app-data-request.util';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataMigrationService } from './app-data-migration.service';
import { AppDataPolicyService } from './app-data-policy.service';

export interface RowQueryFilter {
  [column: string]: string | number | boolean | null;
}

@Injectable()
export class AppDataQueryService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly migrations: AppDataMigrationService,
    private readonly policies: AppDataPolicyService,
  ) {}

  async listRows(params: {
    appDataId: string;
    environment: AppDataEnvironment;
    table: string;
    filters?: RowQueryFilter;
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
    principal: AppDataPrincipal;
    ownerUserId: string;
    requestUserId?: string | null;
    /** Skip row-level policy check (owner Data tab is already guarded). */
    skipPolicyCheck?: boolean;
  }) {
    assertIdentifier(params.table, 'table name');
    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    const env = await this.catalog.getEnvironment(app.id, params.environment);
    if (!env?.provisionedAt) {
      throw new AppDataException(AppDataErrorCode.NOT_PROVISIONED, 'Environment not provisioned');
    }
    if (!params.skipPolicyCheck) {
      const policyDoc = await this.policies.getPolicies(app.workspaceId, params.environment);
      this.policies.assertAllowed(policyDoc[params.table], 'select', params.principal, params.table);
    }

    const pageSize = Math.min(
      parsePositiveInt(params.pageSize, this.config.get<number>('appData.defaultPageSize', 50)),
      this.config.get<number>('appData.maxPageSize', 200),
    );
    const page = parsePositiveInt(params.page, 1);
    const offset = (page - 1) * pageSize;

    const manifest = await this.migrations.getCurrentManifest(app.id, params.environment);
    const tableDef = manifest.tables[params.table];
    if (!tableDef) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown table: ${params.table}`);
    }

    const filterEntries = Object.entries(params.filters ?? {});
    if (filterEntries.length > APP_DATA_MAX_LIST_FILTERS) {
      throw new AppDataException(
        AppDataErrorCode.LIMIT_EXCEEDED,
        `Too many filters (max ${APP_DATA_MAX_LIST_FILTERS})`,
      );
    }

    const where: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [col, val] of filterEntries) {
      assertIdentifier(col, 'column name');
      if (!(col in tableDef.columns)) {
        throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown column: ${col}`);
      }
      where.push(`${quoteIdent(col)} = $${idx++}`);
      values.push(val);
    }

    const orderCol = params.orderBy ?? Object.keys(tableDef.columns)[0];
    assertIdentifier(orderCol, 'order column');
    if (!(orderCol in tableDef.columns)) {
      throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown order column: ${orderCol}`);
    }
    const dir = params.orderDir === 'desc' ? 'DESC' : 'ASC';

    const schemaQ = quoteIdent(env.schemaName);
    const tableQ = quoteIdent(params.table);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM ${schemaQ}.${tableQ} ${whereSql} ORDER BY ${quoteIdent(orderCol)} ${dir} LIMIT $${idx++} OFFSET $${idx++}`;
    values.push(pageSize, offset);

    const countSql = `SELECT COUNT(*)::int AS count FROM ${schemaQ}.${tableQ} ${whereSql}`;
    const client = await this.pool.connect();
    try {
      const timeoutMs = this.config.get<number>('appData.statementTimeoutMs', 30_000);
      await client.query("SELECT set_config('statement_timeout', $1, false)", [String(Math.max(1, Math.floor(Number(timeoutMs))))]);
      const countResult = await client.query(countSql, values.slice(0, where.length));
      const rowsResult = await client.query(sql, values);
      return {
        rows: rowsResult.rows,
        page,
        pageSize,
        total: countResult.rows[0]?.count ?? 0,
      };
    } finally {
      client.release();
    }
  }

  async getRow(params: {
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
    return this.listRows({
      appDataId: params.appDataId,
      environment: params.environment,
      table: params.table,
      filters: { [idColumn]: params.id },
      page: 1,
      pageSize: 1,
      principal: params.principal,
      ownerUserId: params.ownerUserId,
      skipPolicyCheck: params.skipPolicyCheck,
    });
  }
}
