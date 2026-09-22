import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PostgresModule } from './postgres.module';
import { PostgresConnectionService } from './postgres-connection.service';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import { LoggerService } from '../logger';

// LoggerModule is @Global but tied to a Mongo connection; supply a global stub
// instead so PostgresConnectionService can resolve its LoggerService dependency.
@Global()
@Module({
  providers: [
    {
      provide: LoggerService,
      useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    },
  ],
  exports: [LoggerService],
})
class FakeLoggerModule {}

describe('PostgresModule', () => {
  it('provides the pool, drizzle db, and connection service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), FakeLoggerModule, PostgresModule],
    }).compile();

    expect(moduleRef.get(PG_POOL)).toBeDefined();
    expect(moduleRef.get(DRIZZLE_DB)).toBeDefined();
    expect(moduleRef.get(PostgresConnectionService)).toBeInstanceOf(PostgresConnectionService);
    // Checked-out clients get a permanent error listener via pool 'connect'.
    expect(moduleRef.get<import('pg').Pool>(PG_POOL).listenerCount('connect')).toBe(1);

    // Close the pool opened by the factory so Jest exits cleanly.
    await moduleRef.close();
  });
});
