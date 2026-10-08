/**
 * Collect Ceph object keys owned by a template before its DB rows cascade away.
 * Content-addressed blobs must still be filtered for remaining references before
 * delete — see ConversationV2TemplateStore.filterUnreferencedBlobKeys.
 */
export function collectTemplateCephKeys(
  template: { coverImage: string; manifestObjectKey: string | null },
  revisions: Array<{
    manifestObjectKey: string;
    files: Array<{ objectKey: string }>;
  }>,
): { coverImage: string; manifestKeys: string[]; blobKeys: string[] } {
  const manifestKeys = uniqueNonEmpty([
    template.manifestObjectKey,
    ...revisions.map((revision) => revision.manifestObjectKey),
  ]);
  const blobKeys = uniqueNonEmpty(
    revisions.flatMap((revision) => revision.files.map((file) => file.objectKey)),
  );
  return { coverImage: template.coverImage, manifestKeys, blobKeys };
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.length)))];
}
