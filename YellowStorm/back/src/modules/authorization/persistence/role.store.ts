/** Row shape of authz.roles. */
export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
  isSystem: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export type RolePatch = Partial<Pick<RoleRecord, 'name' | 'description' | 'permissions' | 'isActive' | 'priority'>>;


export interface RoleStore {
  /** All roles, priority desc then name asc (admin list). */
  findAll(): Promise<RoleRecord[]>;
  findAllActive(): Promise<RoleRecord[]>;
  findById(id: string): Promise<RoleRecord | null>;
  findByIds(ids: string[]): Promise<Map<string, RoleRecord>>;
  findByName(name: string): Promise<RoleRecord | null>;
  create(init: { name: string; description: string; permissions: string[]; isSystem?: boolean; priority?: number; isActive?: boolean }): Promise<RoleRecord>;
  update(id: string, patch: RolePatch): Promise<RoleRecord | null>;
  /**
   * Atomic delete (plan 1A.2): removes the role, detaches it from every user
   * (junction cascade in PG / $pull in Mongo) and bumps the affected users'
   * permissions_version in the same transaction. Returns the deleted role.
   */
  deleteByIdAndDetach(id: string): Promise<RoleRecord | null>;
  /** Seed defaults: INSERT … ON CONFLICT (name) DO NOTHING semantics. */
  ensureDefaults(roles: Array<{ name: string; description: string; permissions: string[]; isSystem?: boolean; priority?: number }>): Promise<void>;
}
