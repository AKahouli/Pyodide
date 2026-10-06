/**
 * Revision-id naming conventions owned by App Runtime.
 *
 * App Runtime resolves every revision id it is handed (starter, template,
 * session), so these live here rather than in the module that happens to
 * produce them. Conversation V2 re-exports them for its own callers.
 */

/** Manifest folder shared by starter revisions and template revisions. */
export const SYSTEM_MANIFEST_PREFIX = 'appbuilder/manifests/_system';

/** Prefix of every template revision id (`template_<templateId>`). */
export const TEMPLATE_REVISION_PREFIX = 'template_';

/** Revision id for a template; resolved by RuntimeRevisionService. */
export function templateRevisionId(templateId: string): string {
  return `${TEMPLATE_REVISION_PREFIX}${templateId}`;
}

/** Manifest object key for a revision in the system folder. */
export function systemManifestKey(revisionId: string): string {
  return `${SYSTEM_MANIFEST_PREFIX}/${revisionId}.json`;
}

export function isTemplateRevisionId(revisionId: string): boolean {
  return revisionId.startsWith(TEMPLATE_REVISION_PREFIX);
}