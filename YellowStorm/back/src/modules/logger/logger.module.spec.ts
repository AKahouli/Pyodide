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
 * The real LoggerModule and PostgresModule side by side: a wiring cycle would only surface at
 * application boot, so it is compiled here. Since the unified-logging cutover the facade no longer
 * feeds the SQL buffer — this proves diagnostic logging performs zero PostgreSQL writes (plan T18).
 */
describeIntegration('LoggerModule with PostgresModule (integration)', () => {
  const { db, close } = makeTestDb();
  const saved: Record<string, string | undefined> = {};
  const overrides: Record<string, string> = {
    POSTGRES_DB: process.env.POSTGRES_TEST_DB ?? '',
    LOGGING_DEFAULT_DISPLAY: 'false',
    LOGGING_PERSISTENCE_ENABLED: 'false',
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

  it('resolves without a dependency cycle and diagnostic logs never reach PostgreSQL', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), LoggerModule, PostgresModule],
    }).compile();

    const buffer = moduleRef.get(LogBufferService);
    const logger = await moduleRef.resolve(LoggerService);
    logger.setContext(CONTEXT);
    logger.log('emitted through the SDK, not the SQL buffer', { answer: 42 });
    logger.error('boom', 'Error: boom\n    at thing (file.ts:1:1)');

    // Closing runs the destroy hooks; whichever order Nest picks, nothing diagnostic may be written.
    await moduleRef.close();
    moduleRef = undefined;

    expect(buffer.getBufferSize()).toBe(0);
    const rows = await db.execute(sql`SELECT message FROM ops.logs WHERE context = ${CONTEXT}`);
    expect(rows.rows).toEqual([]);
  });
});
