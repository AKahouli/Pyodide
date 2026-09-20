import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import semanticModelConfig from '@config/semantic-model.config';
import { LoggerService } from '@modules/logger';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import {
  attachCheckedOutClientErrorHandler,
  auxPoolTuningFromEnv,
  buildPgSslOptions,
  sslSettingsFromEnv,
} from '@modules/postgres/pg-pool-options';

const BOOTSTRAP_SCRIPT_CANDIDATES = [
  // Prod / dev with nest-cli assets copying scripts into dist
  path.join('..', '..', '..', '..', 'scripts', 'semantic-model', '000_deploy_all.sql'),
  // Fallback: back/ project root (when running from dist without assets copy, or from src via ts-node)
  path.join('..', '..', '..', '..', '..', 'scripts', 'semantic-model', '000_deploy_all.sql'),
];

/**
 * Split the bundled bootstrap SQL into relational definitions and the Apache
 * AGE section (002). Definitions run on the definitions pool, AGE setup on
 * the graph pool, so agentstore-style deployments (no AGE) never see LOAD 'age'.
 * Fails closed when the section markers move.
 */
export interface AgeConnectionTuple {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** True only when every effective connection field matches: any difference selects a separate AGE pool. */
export function isSameConnection(a: AgeConnectionTuple, b: AgeConnectionTuple): boolean {
  return (
    a.host === b.host
    && a.port === b.port
    && a.user === b.user
    && a.password === b.password
    && a.database === b.database
  );
}

export function splitAgeBootstrap(sql: string): { definitions: string; ageSection: string } {
  const startMarker = '-- 002 —';
  const endMarker = '-- 003 —';
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Semantic Model bootstrap SQL is missing the AGE section markers');
  }
  const ageSection = sql.slice(start, end);
  if (!ageSection.includes("LOAD 'age'") || !ageSection.includes('create_graph')) {
    throw new Error('Semantic Model bootstrap SQL AGE section content is unexpected');
  }
  return { definitions: sql.slice(0, start) + sql.slice(end), ageSection };
}

@Injectable()
export class SemanticModelDatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;
  private agePool: Pool | null = null;

  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly logger: LoggerService,
    private readonly featureVisibility: FeatureVisibilityService,
  ) {
    this.logger.setContext(SemanticModelDatabaseService.name);
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.host || !this.config.user || !this.config.database) return;
    this.pool = this.buildPool(
      {
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
      },
      'semantic',
    );
    // AGE graph pool defaults to the definitions database (legacy single-DB);
    // setting SEMANTIC_AGEGRAPH_* splits graph I/O onto its own instance.
    const ageConnection = {
      host: this.config.ageHost || this.config.host,
      port: this.config.agePort,
      user: this.config.ageUser || this.config.user,
      password: this.config.agePassword || this.config.password,
      database: this.config.ageDatabase || this.config.database,
    };
    // Any effective connection difference selects a separate pool; otherwise
    // graph I/O would silently run against the non-AGE definitions database.
    const pgConnection: AgeConnectionTuple = {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
    };
    if (isSameConnection(pgConnection, ageConnection)) {
      this.agePool = this.pool;
    } else {
      this.agePool = this.buildPool(ageConnection, 'semantic-age');
    }
    await this.bootstrapSchema();
  }

  private buildPool(
    connection: { host: string; port: number; user: string; password: string; database: string },
    label: string,
  ): Pool {
    const pool = new Pool({
      ...connection,
      ssl: buildPgSslOptions(sslSettingsFromEnv(this.config.ssl), this.logger, label),
      ...auxPoolTuningFromEnv('SEMANTIC_PG', `:${label}`, process.env, {
        max: this.config.poolMax,
        statementTimeoutMs: 60_000,
      }),
    });
    attachCheckedOutClientErrorHandler(pool, this.logger, label);
    pool.on('error', (error) => {
      this.logger.error('Semantic Model PostgreSQL pool error', { error: error.message });
    });
    return pool;
  }

  private async bootstrapSchema(): Promise<void> {
    const scriptPath = this.resolveBootstrapScriptPath();
    const sql = await readFile(scriptPath, 'utf8');
    const { definitions, ageSection } = splitAgeBootstrap(sql);
    const client = await this.pool!.connect();
    try {
      await client.query(definitions);
      this.logger.log(`Semantic Model schema bootstrapped from ${scriptPath}`);
    } finally {
      client.release();
    }
    // Library loading is a deployment setting (session_preload_libraries on the
    // graph database); an app role may not LOAD. The remaining statements fail
    // loudly if AGE is genuinely unavailable.
    const ageSetup = ageSection
      .split('\n')
      .filter((line) => !line.trim().toUpperCase().startsWith('LOAD '))
      .join('\n');
    const ageClient = await this.agePool!.connect();
    try {
      await ageClient.query(ageSetup);
    } finally {
      ageClient.release();
    }
  }

  private resolveBootstrapScriptPath(): string {
    const attempts = BOOTSTRAP_SCRIPT_CANDIDATES.map((relative) => path.resolve(__dirname, relative));
    const found = attempts.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error(
        `Semantic Model bootstrap SQL not found. Tried: ${attempts.join(', ')}`,
      );
    }
    return found;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    if (this.agePool && this.agePool !== this.pool) await this.agePool.end();
    this.pool = null;
    this.agePool = null;
  }

  isEnabled(): boolean {
    return this.featureVisibility.isEnabled('semanticModel');
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.getPool().query<T>(text, [...values]);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    let released = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      let rollbackErr: Error | undefined;
      try {
        await client.query('ROLLBACK');
      } catch (err) {
        rollbackErr = err instanceof Error ? err : new Error(String(err));
        this.logger.warn('Semantic Model ROLLBACK failed; discarding client', { error: rollbackErr.message });
      }
      // A failed ROLLBACK leaves the client in an unknown state: destroy it.
      client.release(rollbackErr);
      released = true;
      throw error;
    } finally {
      if (!released) client.release();
    }
  }

  async health(): Promise<{ enabled: boolean; ready: boolean; latencyMs: number }> {
    if (!this.isEnabled()) return { enabled: false, ready: true, latencyMs: 0 };
    const startedAt = Date.now();
    const schema = await this.query<{ schema_ready: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'semantic_model') AS schema_ready`,
    );
    const ageClient = await this.getAgePool().connect();
    try {
      const graph = await ageClient.query<{ graph_ready: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1) AS graph_ready`,
        [this.config.ageGraph],
      );
      return {
        enabled: true,
        ready: Boolean(schema.rows[0]?.schema_ready && graph.rows[0]?.graph_ready),
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      ageClient.release();
    }
  }

  async acquireClient(): Promise<PoolClient> {
    return this.getPool().connect();
  }

  /** Dedicated AGE graph connection. Falls back to the definitions pool on legacy single-DB deployments. */
  async acquireAgeClient(): Promise<PoolClient> {
    return this.getAgePool().connect();
  }

  graphName(): string {
    return this.config.ageGraph;
  }

  private getPool(): Pool {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic Models are disabled',
      );
    }
    if (!this.pool) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic Model storage is not configured',
      );
    }
    return this.pool;
  }

  private getAgePool(): Pool {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic Models are disabled',
      );
    }
    const pool = this.agePool ?? this.pool;
    if (!pool) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic Model graph storage is not configured',
      );
    }
    return pool;
  }

}
