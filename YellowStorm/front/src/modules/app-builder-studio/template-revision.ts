/** Prefix of every template revision id (`template_<templateId>`). */
export const TEMPLATE_REVISION_PREFIX = 'template_';

/** True when the session boots from an App Market template, not the system starter. */
export function isTemplateRevisionId(revisionId: string | null | undefined): boolean {
  return typeof revisionId === 'string' && revisionId.startsWith(TEMPLATE_REVISION_PREFIX);
}
