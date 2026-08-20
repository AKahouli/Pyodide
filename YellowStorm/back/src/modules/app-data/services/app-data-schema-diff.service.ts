import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AppDataMigrationClassification } from '../constants/app-data.constants';
import type {
  AppDataColumnDef,
  AppDataMigrationOperation,
  AppDataMigrationPlan,
  AppDataSchemaManifest,
  AppDataTableDef,
} from '../constants/app-data.types';

@Injectable()
export class AppDataSchemaDiffService {
  hashManifest(manifest: AppDataSchemaManifest): string {
    const normalized = JSON.stringify(manifest);
    return createHash('sha256').update(normalized).digest('hex');
  }

  planMigration(from: AppDataSchemaManifest, to: AppDataSchemaManifest): AppDataMigrationPlan {
    const operations: AppDataMigrationOperation[] = [];
    const fromTables = from.tables ?? {};
    const toTables = to.tables ?? {};

    for (const table of Object.keys(fromTables)) {
      if (!toTables[table]) {
        operations.push({
          kind: 'drop_table',
          table,
          classification: 'destructive',
        });
      }
    }

    for (const table of Object.keys(toTables)) {
      if (!fromTables[table]) {
        operations.push({
          kind: 'create_table',
          table,
          classification: 'safe',
        });
      }
    }

    for (const table of Object.keys(toTables)) {
      const fromCols = fromTables[table]?.columns ?? {};
      const toCols = toTables[table]?.columns ?? {};
      if (!fromTables[table]) continue;

      for (const col of Object.keys(fromCols)) {
        if (!toCols[col]) {
          operations.push({
            kind: 'drop_column',
            table,
            column: col,
            classification: 'destructive',
          });
        }
      }

      for (const col of Object.keys(toCols)) {
        const toDef = toCols[col];
        const fromDef = fromCols[col];
        if (!fromDef) {
          operations.push({
            kind: 'add_column',
            table,
            column: col,
            columnDef: toDef,
            classification: toDef.nullable === false && toDef.default === undefined ? 'destructive' : 'safe',
          });
          continue;
        }
        if (fromDef.nullable === false && toDef.nullable === true) {
          operations.push({
            kind: 'alter_column_nullable',
            table,
            column: col,
            columnDef: toDef,
            classification: 'safe',
          });
        }
        if (fromDef.nullable === true && toDef.nullable === false) {
          operations.push({
            kind: 'alter_column_nullable',
            table,
            column: col,
            columnDef: toDef,
            classification: 'destructive',
          });
        }
        if (fromDef.type !== toDef.type) {
          operations.push({
            kind: 'drop_column',
            table,
            column: col,
            classification: 'destructive',
          });
          operations.push({
            kind: 'add_column',
            table,
            column: col,
            columnDef: toDef,
            classification: 'destructive',
          });
        }
      }
    }

    const hasDestructive = operations.some((op) => op.classification === 'destructive');
    return {
      fromVersion: from.version,
      toVersion: to.version,
      operations,
      hasDestructive,
    };
  }

  buildTargetManifest(current: AppDataSchemaManifest, nextManifest: AppDataSchemaManifest): AppDataSchemaManifest {
    return {
      version: nextManifest.version,
      tables: nextManifest.tables,
    };
  }

  emptyAtVersion(version: number): AppDataSchemaManifest {
    return { version, tables: {} };
  }

  tableDef(manifest: AppDataSchemaManifest, table: string): AppDataTableDef | null {
    return manifest.tables[table] ?? null;
  }

  overallClassification(plan: AppDataMigrationPlan): AppDataMigrationClassification {
    return plan.hasDestructive ? 'destructive' : 'safe';
  }
}
