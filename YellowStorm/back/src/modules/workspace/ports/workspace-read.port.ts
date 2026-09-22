import type { WorkspaceRecord } from './workspace-records';

export const WORKSPACE_READ_PORT = Symbol('WORKSPACE_READ_PORT');

export interface WorkspaceReadPort {
  findById(id: string): Promise<WorkspaceRecord | null>;
  findByIds(ids: string[]): Promise<Map<string, WorkspaceRecord>>;
  exists(id: string): Promise<boolean>;
}
