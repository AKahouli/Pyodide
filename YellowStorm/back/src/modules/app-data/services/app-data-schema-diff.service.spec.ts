import { Test, TestingModule } from '@nestjs/testing';
import { AppDataSchemaDiffService } from './app-data-schema-diff.service';

describe('AppDataSchemaDiffService', () => {
  let svc: AppDataSchemaDiffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppDataSchemaDiffService],
    }).compile();
    svc = module.get(AppDataSchemaDiffService);
  });

  it('plans create_table as safe', () => {
    const plan = svc.planMigration(
      { version: 0, tables: {} },
      {
        version: 1,
        tables: {
          contacts: {
            columns: {
              id: { type: 'uuid', primaryKey: true },
              email: { type: 'text', nullable: false },
            },
          },
        },
      },
    );
    expect(plan.hasDestructive).toBe(false);
    expect(plan.operations.some((op) => op.kind === 'create_table')).toBe(true);
  });

  it('plans drop_column as destructive', () => {
    const from = {
      version: 1,
      tables: {
        contacts: {
          columns: {
            id: { type: 'uuid' as const, primaryKey: true },
            email: { type: 'text' as const },
          },
        },
      },
    };
    const to = {
      version: 2,
      tables: {
        contacts: {
          columns: {
            id: { type: 'uuid' as const, primaryKey: true },
          },
        },
      },
    };
    const plan = svc.planMigration(from, to);
    expect(plan.hasDestructive).toBe(true);
    expect(plan.operations.some((op) => op.kind === 'drop_column')).toBe(true);
  });
});
