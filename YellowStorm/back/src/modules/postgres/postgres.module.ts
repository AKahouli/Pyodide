import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import postgresConfig, { PostgresConfig } from '../../config/postgres.config';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import { PostgresConnectionService } from './postgres-connection.service';
import { PgTtlSweeper } from './ttl/pg-ttl-sweeper.service';
import * as schema from './schema';

@Global()
@Module({
  imports: [ConfigModule.forFeature(postgresConfig)],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const cfg = configService.get<PostgresConfig>('postgres')!;
        const pool = new Pool({
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
          max: cfg.maxPoolSize,
          idleTimeoutMillis: cfg.idleTimeoutMs,
          connectionTimeoutMillis: cfg.connectionTimeoutMs,
          statement_timeout: cfg.statementTimeoutMs,
          idle_in_transaction_session_timeout: cfg.idleInTransactionTimeoutMs,
          keepAlive: cfg.keepAlive,
          application_name: cfg.applicationName,
        });
        return pool;
      },
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    PostgresConnectionService,
    PgTtlSweeper,
  ],
  exports: [PostgresConnectionService, PgTtlSweeper, PG_POOL, DRIZZLE_DB],
})
export class PostgresModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
