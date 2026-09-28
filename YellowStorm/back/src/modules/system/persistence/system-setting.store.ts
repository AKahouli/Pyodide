/**
 * Store port for catalog.system_settings (plan 1B.2.1) — the keyed
 * settings blob table shared by the system/settings services.
 * `value` is the Mongo `value` object, stored verbatim as jsonb.
 */
export const SYSTEM_SETTING_STORE = Symbol('SYSTEM_SETTING_STORE');

export interface SystemSettingRow {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface SystemSettingStore {
  get(key: string): Promise<SystemSettingRow | null>;
  getMany(keys: string[]): Promise<SystemSettingRow[]>;
  /** Returns every stored setting row (used by the admin export/import). */
  listAll(): Promise<SystemSettingRow[]>;
  upsert(key: string, value: unknown): Promise<SystemSettingRow>;
  delete(key: string): Promise<void>;
}
