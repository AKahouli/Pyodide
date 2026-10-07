/**
 * Persistence ports for the Conversation V2 template catalog
 * (`conversation_v2.template_categories` + `conversation_v2.templates`).
 * All SQL lives in the Postgres implementation; services never query directly.
 */
import type { TemplatePlatformReport } from '@modules/app-runtime/platform-kit/platform-template-report';

export const APP_BUILDER_TEMPLATE_CATEGORY_STORE = Symbol(
  'APP_BUILDER_TEMPLATE_CATEGORY_STORE',
);
export const APP_BUILDER_TEMPLATE_STORE = Symbol('APP_BUILDER_TEMPLATE_STORE');

export type AppBuilderTemplateStatus = 'draft' | 'published';

export interface AppBuilderTemplateCategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppBuilderTemplateRow {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  /** Ceph object key of the cover image (empty when none). */
  coverImage: string;
  /** `template_<id>` once published, else null. */
  revisionId: string | null;
  manifestObjectKey: string | null;
  status: AppBuilderTemplateStatus;
  /** Platform Kit analysis of the uploaded ZIP; null before the first publish. */
  platformReport: TemplatePlatformReport | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One published template revision's manifest metadata (`template_revisions`). */
export interface AppBuilderTemplateRevisionRow {
  id: string;
  templateId: string;
  revisionId: string;
  manifestObjectKey: string;
  manifestHash: string;
  files: Array<{ path: string; sha256: string; objectKey: string; size: number }>;
  fileCount: number;
  status: AppBuilderTemplateStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppBuilderTemplateCategoryStore {
  findById(id: string): Promise<AppBuilderTemplateCategoryRow | null>;
  findBySlug(slug: string): Promise<AppBuilderTemplateCategoryRow | null>;
  /** Case-insensitive name lookup (name uniqueness is enforced on the raw value). */
  findByNameInsensitive(name: string): Promise<AppBuilderTemplateCategoryRow | null>;
  findAll(): Promise<AppBuilderTemplateCategoryRow[]>;
  insert(row: { name: string; slug: string; icon: string }): Promise<AppBuilderTemplateCategoryRow>;
  update(
    id: string,
    patch: { name?: string; slug?: string; icon?: string },
  ): Promise<AppBuilderTemplateCategoryRow | null>;
  delete(id: string): Promise<boolean>;
  /** template counts per category id (gallery listing). */
  countTemplatesByCategoryIds(ids: string[]): Promise<Map<string, number>>;
}

export interface AppBuilderTemplateStore {
  findById(id: string): Promise<AppBuilderTemplateRow | null>;
  findByRevisionId(revisionId: string): Promise<AppBuilderTemplateRow | null>;
  findByCategoryId(categoryId: string): Promise<AppBuilderTemplateRow[]>;
  findByCategoryAndTitle(
    categoryId: string,
    title: string,
  ): Promise<AppBuilderTemplateRow | null>;
  /** Published templates, optionally scoped to one category, newest first. */
  listPublished(categoryId?: string): Promise<AppBuilderTemplateRow[]>;
  listAll(): Promise<AppBuilderTemplateRow[]>;
  insert(row: {
    categoryId: string;
    title: string;
    description: string;
    coverImage: string;
  }): Promise<AppBuilderTemplateRow>;
  update(
    id: string,
    patch: { categoryId?: string; title?: string; description?: string; coverImage?: string },
  ): Promise<AppBuilderTemplateRow | null>;
  /** Bind the Ceph revision to a still-draft template (pending validation). */
  setRevision(
    id: string,
    binding: {
      revisionId: string;
      manifestObjectKey: string;
      platformReport?: TemplatePlatformReport;
    },
  ): Promise<AppBuilderTemplateRow | null>;
  /** Flip template status to published. */
  markPublished(id: string): Promise<AppBuilderTemplateRow | null>;
  delete(id: string): Promise<AppBuilderTemplateRow | null>;

  /** Insert-or-replace the revision row keyed by `revisionId` (one publish event). */
  upsertRevision(row: {
    templateId: string;
    revisionId: string;
    manifestObjectKey: string;
    manifestHash: string;
    files: Array<{ path: string; sha256: string; objectKey: string; size: number }>;
  }): Promise<AppBuilderTemplateRevisionRow>;
  /** RuntimeRevisionService resolves `template_<id>` back to its manifest metadata. */
  findRevisionByRevisionId(
    revisionId: string,
  ): Promise<AppBuilderTemplateRevisionRow | null>;
  /** Flip every revision row of the template to published (validation confirmed). */
  markRevisionsPublished(templateId: string): Promise<void>;
  listRevisionsByTemplate(templateId: string): Promise<AppBuilderTemplateRevisionRow[]>;
  /**
   * Of the candidate content-addressed blob keys, return those that no longer
   * appear in any remaining template revision or workspace source revision.
   * Call after the deleted template's revision rows have already cascaded away.
   */
  filterUnreferencedBlobKeys(candidates: string[]): Promise<string[]>;
}
