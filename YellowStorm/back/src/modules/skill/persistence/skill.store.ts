/** Store ports for catalog.skill_categories, catalog.skills and catalog.skill_files (plan 1B.4.2). */
export const SKILL_STORE = Symbol('SKILL_STORE');

export interface SkillCategoryRow {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillCategoryStore {
  findAll(): Promise<SkillCategoryRow[]>;
  findById(id: string): Promise<SkillCategoryRow | null>;
  /** Case-insensitive lookup used by the "System" reserved-category guard. */
  findByNameInsensitive(name: string): Promise<SkillCategoryRow | null>;
  /** INSERT … ON CONFLICT (name) DO UPDATE SET is_system = true. */
  ensureSystem(data: { name: string; description: string }): Promise<void>;
  insert(data: { name: string; description: string; isSystem?: boolean }): Promise<SkillCategoryRow>;
  update(id: string, patch: { name?: string; description?: string }): Promise<SkillCategoryRow | null>;
  delete(id: string): Promise<boolean>;
  findNamesByIds(ids: string[]): Promise<Map<string, string>>;
}

export interface SkillFileRow {
  id: string;
  path: string;
  kind: string;
  mimeType: string;
  content: string;
  position: number;
}

export interface SkillRow {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: string;
  categoryId: string | null;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  instructions: string;
  /** File content is loaded only by detail/gRPC reads (plan 1B.4.2). */
  files: SkillFileRow[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSkillFile {
  path: string;
  kind: string;
  mimeType: string;
  content: string;
}

export interface NewSkillRow {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: string;
  categoryId: string | null;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  instructions: string;
  files: NewSkillFile[];
  isActive: boolean;
  createdBy: string;
}

export interface SkillListQuery {
  search?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

export interface SkillStore {
  /** Detail read — includes file content. */
  findById(id: string): Promise<SkillRow | null>;
  findByIds(ids: string[]): Promise<SkillRow[]>;
  /** List reads — file content NOT loaded (empty files array). */
  list(query: SkillListQuery): Promise<{ rows: SkillRow[]; total: number }>;
  findAllActive(): Promise<SkillRow[]>;
  /** Conflict probe for create: same owner with same name or slug. */
  findByOwnerNameOrSlug(createdBy: string, name: string, slug: string): Promise<SkillRow | null>;
  findByOwnerSlug(createdBy: string, slug: string): Promise<SkillRow | null>;
  findByOwnerNameExcluding(createdBy: string, excludeId: string, name: string): Promise<SkillRow | null>;
  findByOwnerSlugExcluding(createdBy: string, excludeId: string, slug: string): Promise<SkillRow | null>;
  /** Owner's skills among `slugs`, as slug → id (connector import resolution). */
  findIdsBySlugs(createdBy: string, slugs: string[]): Promise<Map<string, string>>;
  /** Export read: with file content, no owner/activity filtering; ids optional. */
  findAllExport(ids?: string[]): Promise<SkillRow[]>;
  insert(row: NewSkillRow): Promise<SkillRow>;
  update(id: string, patch: Partial<Omit<NewSkillRow, 'createdBy' | 'slug' | 'name'>> & { slug?: string | null; name?: string }): Promise<SkillRow | null>;
  delete(id: string): Promise<SkillRow | null>;
}
