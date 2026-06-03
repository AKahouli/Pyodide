function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeObjectKey(value: unknown): string {
  const text = asString(value).trim();
  const vectorStorePrefix = 's3://vectorstore/';
  return text.startsWith(vectorStorePrefix)
    ? text.slice(vectorStorePrefix.length)
    : text;
}

function normalizeCitationData(source: Record<string, unknown>): Record<string, unknown> {
  const sourceType = asString(source.sourceType ?? source.type) === 'image' ? 'image' : 'text';
  const fileName = asString(source.fileName ?? source.file_name);

  if (sourceType === 'image') {
    return {
      parentId: asString(source.parentId ?? source.parent_id),
      sourceType,
      source: fileName,
      path: normalizeObjectKey(source.path ?? source.source),
      fileName,
      page: asString(source.page),
      pageContent: asString(source.pageContent ?? source.page_content ?? source.content),
      workspaceId: asString(source.workspaceId ?? source.workspace_id ?? source.workspace_name),
      height: asString(source.height),
      width: asString(source.width),
      reference: asString(source.reference),
    };
  }

  return {
    parentId: asString(source.parentId ?? source.parent_id),
    sourceType,
    source: normalizeObjectKey(source.source ?? source.path),
    externalId: asString(source.externalId ?? source.external_id ?? source.source),
    fileName,
    page: asString(source.page),
    pageContent: asString(source.pageContent ?? source.page_content ?? source.content),
    workspaceId: asString(source.workspaceId ?? source.workspace_id ?? source.workspace_name),
    reference: asString(source.reference),
  };
}

function normalizeCitationComponent(component: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(component.data) ?? component;
  const textSource = asRecord(data.text_source ?? data.textSource);
  const imageSource = asRecord(data.image_source ?? data.imageSource);
  const source = textSource ?? imageSource ?? data;

  return {
    ...component,
    type: 'citation',
    data: normalizeCitationData({
      ...source,
      type: imageSource ? 'image' : source.type,
      parentId: data.parentId ?? data.parent_id ?? source.parentId ?? source.parent_id,
    }),
  };
}

export function normalizePlaybookComponents(
  components: Array<Record<string, unknown>> | undefined,
  citationSources: unknown,
): Array<Record<string, unknown>> | undefined {
  const normalized = (components ?? []).map((component) => (
    component.type === 'citation' ? normalizeCitationComponent(component) : component
  ));

  if (Array.isArray(citationSources)) {
    for (const source of citationSources) {
      const record = asRecord(source);
      if (record) {
        normalized.push({ type: 'citation', data: normalizeCitationData(record) });
      }
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}
