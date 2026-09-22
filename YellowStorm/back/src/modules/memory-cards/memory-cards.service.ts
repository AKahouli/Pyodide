import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { LoggerService } from '../logger';
import {
  attachCheckedOutClientErrorHandler,
  auxPoolTuningFromEnv,
  buildPgSslOptions,
  sslSettingsFromEnv,
} from '../postgres/pg-pool-options';
import { MemoryCardResponse } from './interfaces/memory-card.interface';

const CONTEXT = 'MemoryCardsService';

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The `keywords` column may come back as a native array (text[]/jsonb) or as a
// raw text form ("{a,b}" or "a, b"); normalise all shapes to string[].
function toKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const inner =
      trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;
    return inner
      .split(',')
      .map((k) => k.trim().replace(/^"|"$/g, ''))
      .filter((k) => k.length > 0);
  }
  return [];
}

function mapRow(row: Record<string, unknown>): MemoryCardResponse {
  return {
    id: String(row.id),
    title: (row.title as string) ?? '',
    summary: (row.summary as string) ?? '',
    content: (row.content as string) ?? '',
    type: (row.type as string) ?? '',
    keywords: toKeywords(row.keywords),
    valid_from: toIso(row.valid_from),
    valid_until: toIso(row.valid_until),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

@Injectable()
export class MemoryCardsService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CONTEXT);
  }

  onModuleInit(): void {
    const host = this.config.get<string>('memoryCards.host');
    if (!host) {
      this.logger.warn(
        'Memory cards Postgres not configured (MEMORY_PG_HOST missing); endpoints will return 503',
      );
      return;
    }

    this.pool = new Pool({
      host,
      port: this.config.get<number>('memoryCards.port'),
      user: this.config.get<string>('memoryCards.user'),
      password: this.config.get<string>('memoryCards.password'),
      database: this.config.get<string>('memoryCards.database'),
      ssl: buildPgSslOptions(
        sslSettingsFromEnv(Boolean(this.config.get<boolean>('memoryCards.ssl'))),
        this.logger,
        'memory-cards',
      ),
      ...auxPoolTuningFromEnv('MEMORY_PG', ':memory-cards'),
    });
    attachCheckedOutClientErrorHandler(this.pool, this.logger, 'memory-cards');

    this.pool.on('error', (err) => {
      this.logger.error('Memory cards PG pool error', { error: err.message });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException('Memory cards database is not configured');
    }
    return this.pool;
  }

  async findByAgent(
    agentId: string,
    options: { search?: string; limit?: number; offset?: number } = {},
  ): Promise<{ memories: MemoryCardResponse[]; total: number }> {
    const pool = this.getPool();

    // Build the shared WHERE clause: always scoped by agent_id, and — when a
    // search term is provided — an ILIKE across every displayed column except
    // the id (dates/keywords are cast to text so they match too).
    const conditions = ['agent_id::text = $1'];
    const params: unknown[] = [agentId];

    const search = options.search?.trim() ?? '';
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(title ILIKE ${p} OR summary ILIKE ${p} OR content ILIKE ${p} OR type ILIKE ${p} ` +
          `OR keywords::text ILIKE ${p} OR valid_from::text ILIKE ${p} OR valid_until::text ILIKE ${p} ` +
          `OR created_at::text ILIKE ${p} OR updated_at::text ILIKE ${p})`,
      );
    }
    const where = conditions.join(' AND ');

    // Total count of the filtered set (for pagination controls).
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM memory_cards_metadata WHERE ${where}`,
      params,
    );
    const total = (countResult.rows[0]?.total as number) ?? 0;

    // Paginated page of rows.
    const pageParams = [...params];
    let limitClause = '';
    if (options.limit !== undefined) {
      pageParams.push(options.limit);
      limitClause += ` LIMIT $${pageParams.length}`;
    }
    if (options.offset !== undefined) {
      pageParams.push(options.offset);
      limitClause += ` OFFSET $${pageParams.length}`;
    }

    const { rows } = await pool.query(
      `SELECT id, title, summary, content, type, keywords, valid_from, valid_until, created_at, updated_at
       FROM memory_cards_metadata
       WHERE ${where}
       ORDER BY created_at DESC${limitClause}`,
      pageParams,
    );

    return { memories: rows.map((row) => mapRow(row as Record<string, unknown>)), total };
  }

  async deleteMany(agentId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Scope by agent_id so a card can never be deleted from another agent by id.
    const { rowCount } = await this.getPool().query(
      `DELETE FROM memory_cards_metadata
       WHERE agent_id::text = $1 AND id::text = ANY($2::text[])`,
      [agentId, ids],
    );
    return rowCount ?? 0;
  }
}
