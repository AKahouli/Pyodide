/** Conversation V2 template catalog limits and Ceph layout constants. */

/** Slug charset enforced by the DB check constraint `c2_tpl_categories_slug_format`. */
export const TEMPLATE_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** System manifest folder shared with the starter revisions. */
export const TEMPLATE_MANIFEST_PREFIX = 'appbuilder/manifests/_system';

/**
 * Synthetic workspace id used by the App Market clone preview. No session or
 * workspace row exists yet at that point; revision authorization only needs a
 * stable id to keep the runtime revision lookups scoped.
 */
export const TEMPLATE_CATALOG_PREVIEW_WORKSPACE_ID = '_catalog';

/** Per-template cover folder; the object key is stored in `templates.cover_image`. */
export const TEMPLATE_COVER_PREFIX = 'appbuilder/templates';

export const TEMPLATE_MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const TEMPLATE_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const TEMPLATE_MAX_ARCHIVE_FILES = 2000;
/** Uncompressed ceiling — guards against a small ZIP inflating into a ZIP bomb. */
export const TEMPLATE_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

export const TEMPLATE_COVER_MIME_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/** Revision id for a template; resolved by RuntimeRevisionService. */
export function templateRevisionId(templateId: string): string {
  return `template_${templateId}`;
}

/** Prefix of every template revision id (`template_<templateId>`). */
export const TEMPLATE_REVISION_PREFIX = 'template_';

export function templateManifestKey(revisionId: string): string {
  return `${TEMPLATE_MANIFEST_PREFIX}/${revisionId}.json`;
}

export function templateCoverKey(templateId: string, extension: string): string {
  return `${TEMPLATE_COVER_PREFIX}/${templateId}/cover${extension}`;
}
