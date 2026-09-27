/**
 * Persistence ports for the Conversation V2 template catalog
 * (`conversation_v2.template_categories` + `conversation_v2.templates`).
 * All SQL lives in the Postgres implementation; services never query directly.
 */
export const CONVERSATION_V2_TEMPLATE_CATEGORY_STORE = Symbol(
  'CONVERSATION_V2_TEMPLATE_CATEGORY_STORE',
);
export const CONVERSATION_V2_TEMPLATE_STORE = Symbol('CONVERSATION_V2_TEMPLATE_STORE');

export type ConversationV2TemplateStatus = 'draft' | 'published';

export interface ConversationV2TemplateCategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationV2TemplateRow {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  /** Ceph object key of the cover image (empty when none). */
  coverImage: string;
  /** `template_<id>` once published, else null. */
  revisionId: string | null;
  manifestObjectKey: string | null;
  status: ConversationV2TemplateStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationV2TemplateCategoryStore {
  findById(id: string): Promise<ConversationV2TemplateCategoryRow | null>;
  findBySlug(slug: string): Promise<ConversationV2TemplateCategoryRow | null>;
  /** Case-insensitive name lookup (name uniqueness is enforced on the raw value). */
  findByNameInsensitive(name: string): Promise<ConversationV2TemplateCategoryRow | null>;
  findAll(): Promise<ConversationV2TemplateCategoryRow[]>;
  insert(row: { name: string; slug: string; icon: string }): Promise<ConversationV2TemplateCategoryRow>;
  update(
    id: string,
    patch: { name?: string; slug?: string; icon?: string },
  ): Promise<ConversationV2TemplateCategoryRow | null>;
  delete(id: string): Promise<boolean>;
  /** template counts per category id (gallery listing). */
  countTemplatesByCategoryIds(ids: string[]): Promise<Map<string, number>>;
}

export interface ConversationV2TemplateStore {
  findById(id: string): Promise<ConversationV2TemplateRow | null>;
  findByRevisionId(revisionId: string): Promise<ConversationV2TemplateRow | null>;
  findByCategoryId(categoryId: string): Promise<ConversationV2TemplateRow[]>;
  findByCategoryAndTitle(
    categoryId: string,
    title: string,
  ): Promise<ConversationV2TemplateRow | null>;
  /** Published templates, optionally scoped to one category, newest first. */
  listPublished(categoryId?: string): Promise<ConversationV2TemplateRow[]>;
  listAll(): Promise<ConversationV2TemplateRow[]>;
  insert(row: {
    categoryId: string;
    title: string;
    description: string;
    coverImage: string;
  }): Promise<ConversationV2TemplateRow>;
  update(
    id: string,
    patch: { categoryId?: string; title?: string; description?: string; coverImage?: string },
  ): Promise<ConversationV2TemplateRow | null>;
  /** Mark a template published with its Ceph manifest binding. */
  setPublished(
    id: string,
    binding: { revisionId: string; manifestObjectKey: string },
  ): Promise<ConversationV2TemplateRow | null>;
  delete(id: string): Promise<ConversationV2TemplateRow | null>;
}
