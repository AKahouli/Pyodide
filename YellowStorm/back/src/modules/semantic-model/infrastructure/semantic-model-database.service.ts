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

const BOOTSTRAP_SCRIPT_CANDIDATES = [
  // Prod / dev with nest-cli assets copying scripts into dist
  path.join('..', '..', '..', '..', 'scripts', 'semantic-model', '000_deploy_all.sql'),
  // Fallback: back/ project root (when running from dist without assets copy, or from src via ts-node)
  path.join('..', '..', '..', '..', '..', 'scripts', 'semantic-model', '000_deploy_all.sql'),
];

@Injectable()
export class SemanticModelDatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;

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
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      max: this.config.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (error) => {
      this.logger.error('Semantic Model PostgreSQL pool error', { error: error.message });
    });
    await this.bootstrapSchema();
  }

  private async bootstrapSchema(): Promise<void> {
    const scriptPath = this.resolveBootstrapScriptPath();
    const sql = await readFile(scriptPath, 'utf8');
    const client = await this.pool!.connect();
    try {
      await client.query(sql);
      this.logger.log(`Semantic Model schema bootstrapped from ${scriptPath}`);
    } finally {
      client.release();
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
    this.pool = null;
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
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async health(): Promise<{ enabled: boolean; ready: boolean; latencyMs: number }> {
    if (!this.isEnabled()) return { enabled: false, ready: true, latencyMs: 0 };
    const startedAt = Date.now();
    const result = await this.query<{ schema_ready: boolean; graph_ready: boolean }>(
      `SELECT
        EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'semantic_model') AS schema_ready,
        EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1) AS graph_ready`,
      [this.config.ageGraph],
    );
    return {
      enabled: true,
      ready: Boolean(result.rows[0]?.schema_ready && result.rows[0]?.graph_ready),
      latencyMs: Date.now() - startedAt,
    };
  }

  async acquireClient(): Promise<PoolClient> {
    return this.getPool().connect();
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

}
