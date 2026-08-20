import type {
  AppDataColumnType,
  AppDataEnvironment,
  AppDataMigrationClassification,
  AppDataPrincipal,
} from './app-data.constants';

export interface AppDataColumnDef {
  type: AppDataColumnType;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: string | number | boolean | null;
}

export interface AppDataTableDef {
  columns: Record<string, AppDataColumnDef>;
}

/** Declarative schema manifest stored immutably per version. */
export interface AppDataSchemaManifest {
  version: number;
  tables: Record<string, AppDataTableDef>;
}

export type AppDataPolicyOperation = 'select' | 'insert' | 'update' | 'delete';

export interface AppDataTablePolicy {
  select?: AppDataPrincipal[];
  insert?: AppDataPrincipal[];
  update?: AppDataPrincipal[];
  delete?: AppDataPrincipal[];
}

export type AppDataPolicyDocument = Record<string, AppDataTablePolicy>;

export interface AppDataMigrationOperation {
  kind:
    | 'create_table'
    | 'drop_table'
    | 'add_column'
    | 'drop_column'
    | 'alter_column_nullable';
  table: string;
  column?: string;
  columnDef?: AppDataColumnDef;
  classification: AppDataMigrationClassification;
}

export interface AppDataMigrationPlan {
  fromVersion: number;
  toVersion: number;
  operations: AppDataMigrationOperation[];
  hasDestructive: boolean;
}

export interface AppDataRuntimeEnv {
  appDataId: string;
  environment: AppDataEnvironment;
  publicUrl: string;
}

export interface AppDataStatus {
  enabled: boolean;
  appDataId: string | null;
  workspaceId: string;
  lifecycleState: string | null;
  dev: {
    provisioned: boolean;
    schemaName: string | null;
    currentVersion: number | null;
  };
  prod: {
    provisioned: boolean;
    schemaName: string | null;
    currentVersion: number | null;
  };
}
