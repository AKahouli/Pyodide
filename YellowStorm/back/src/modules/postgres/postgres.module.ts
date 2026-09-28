import { Global, Module, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import postgresConfig, { PostgresConfig } from '../../config/postgres.config';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import { PostgresConnectionService } from './postgres-connection.service';
import { PgTtlSweeper } from './ttl/pg-ttl-sweeper.service';
import { PgTtlRegistrationService } from './ttl/pg-ttl-registration.service';
import { attachCheckedOutClientErrorHandler, buildPgSslOptions } from './pg-pool-options';
import { LogBufferService, LoggerService } from '../logger';
import * as schema from './schema';

@Global()
@Module({
  imports: [ConfigModule.forFeature(postgresConfig)],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService, LoggerService],
      useFactory: (configService: ConfigService, logger: LoggerService) => {
        const cfg = configService.get<PostgresConfig>('postgres')!;
        logger.setContext('PostgresPool');
        const pool = new Pool({
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          ssl: buildPgSslOptions(
            { enabled: cfg.ssl, ca: cfg.sslCa, rejectUnauthorized: cfg.sslRejectUnauthorized },
            logger,
            'main',
          ),
          max: cfg.maxPoolSize,
          idleTimeoutMillis: cfg.idleTimeoutMs,
          connectionTimeoutMillis: cfg.connectionTimeoutMs,
          statement_timeout: cfg.statementTimeoutMs,
          idle_in_transaction_session_timeout: cfg.idleInTransactionTimeoutMs,
          keepAlive: cfg.keepAlive,
          keepAliveInitialDelayMillis: cfg.keepAliveInitialDelayMs,
          application_name: cfg.applicationName,
        });
        // 'error' on the pool itself is attached once in PostgresConnectionService.
        attachCheckedOutClientErrorHandler(pool, logger, 'main');
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
    PgTtlRegistrationService,
  ],
  exports: [PostgresConnectionService, PgTtlSweeper, PG_POOL, DRIZZLE_DB],
})
export class PostgresModule implements OnModuleDestroy {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() private readonly logBuffer?: LogBufferService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // The buffered logs are written through this pool: flush them before it closes, whatever the hook order.
    await this.logBuffer?.flush();
    await this.pool.end();
  }
}
