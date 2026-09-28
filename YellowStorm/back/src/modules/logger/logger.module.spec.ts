import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { PostgresModule } from '../postgres/postgres.module';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';
import { LogBufferService } from './log-buffer.service';
import { LoggerModule } from './logger.module';
import { LoggerService } from './logger.service';

const CONTEXT = 'LoggerModuleSpec';

/**
 * The real LoggerModule and PostgresModule side by side. The connection pool needs a LoggerService, which
 * needs the log buffer, which writes through that pool: a wiring cycle would only surface at application
 * boot, so it is compiled here. It also proves the final flush lands before the pool is closed.
 */
describeIntegration('LoggerModule with PostgresModule (integration)', () => {
  const { db, close } = makeTestDb();
  const saved: Record<string, string | undefined> = {};
  const overrides: Record<string, string> = {
    POSTGRES_DB: process.env.POSTGRES_TEST_DB ?? '',
    LOGGING_DEFAULT_DISPLAY: 'false',
    LOGGING_BUFFER_SIZE: '100000',
    LOGGING_FLUSH_INTERVAL_MS: '3600000',
    LOG_LEVEL: 'info',
  };
  let moduleRef: TestingModule | undefined;

  beforeAll(() => {
    for (const [key, value] of Object.entries(overrides)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });
  afterAll(async () => {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await db.execute(sql`DELETE FROM ops.logs WHERE context = ${CONTEXT}`);
    await close();
  });
  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('resolves without a dependency cycle, and flushes the buffered logs before the pool closes', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), LoggerModule, PostgresModule],
    }).compile();

    const buffer = moduleRef.get(LogBufferService);
    const logger = await moduleRef.resolve(LoggerService);
    logger.setContext(CONTEXT);
    logger.log('written through the wired module', { answer: 42 });
    expect(buffer.getBufferSize()).toBeGreaterThan(0);

    // Closing runs the destroy hooks; whichever order Nest picks, the entry must reach the table.
    await moduleRef.close();
    moduleRef = undefined;

    const rows = await db.execute(sql`SELECT message, data FROM ops.logs WHERE context = ${CONTEXT}`);
    expect(rows.rows).toEqual([{ message: 'written through the wired module', data: { answer: 42 } }]);
  });
});
