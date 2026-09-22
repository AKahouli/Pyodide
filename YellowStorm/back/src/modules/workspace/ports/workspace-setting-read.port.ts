import type { WorkspaceSettingRecord } from './workspace-records';

export const WORKSPACE_SETTING_READ_PORT = Symbol('WORKSPACE_SETTING_READ_PORT');

export interface WorkspaceSettingReadPort {
  findById(id: string): Promise<WorkspaceSettingRecord | null>;
  findByIds(ids: string[]): Promise<Map<string, WorkspaceSettingRecord>>;
}
