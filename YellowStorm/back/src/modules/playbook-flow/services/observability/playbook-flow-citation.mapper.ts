function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function normalizeObjectKey(value: unknown): string {
  const text = asString(value).trim();
  const vectorStorePrefix = 's3://vectorstore/';
  return text.startsWith(vectorStorePrefix)
    ? text.slice(vectorStorePrefix.length)
    : text;
}

function normalizeBBox(value: unknown): unknown {
  return Array.isArray(value) ? value : undefined;
}

function normalizeCitationData(source: Record<string, unknown>): Record<string, unknown> {
  const rawSourceType = asString(source.sourceKind ?? source.sourceType ?? source.type);
  const sourceType = rawSourceType === 'web' ? 'web' : rawSourceType === 'image' ? 'image' : 'text';
  const fileName = asString(source.fileName ?? source.file_name);
  const highlightText = asString(source.highlightText ?? source.highlight_text);
  const highlightBBox = normalizeBBox(source.highlightBBox ?? source.highlight_bbox);
  const blockBBox = normalizeBBox(source.blockBBox ?? source.block_bbox);

  if (sourceType === 'web') {
    return {
      parentId: asString(source.parentId ?? source.parent_id),
      sourceKind: 'web',
      sourceType: 'web',
      source: asString(source.source ?? source.url),
      title: asString(source.title),
      reference: asString(source.reference),
      exactText: asString(source.exactText ?? source.exact_text),
      prefix: asString(source.prefix),
      suffix: asString(source.suffix),
      evidenceOrigin: asString(source.evidenceOrigin ?? source.evidence_origin),
    };
  }

  if (sourceType === 'image') {
    return {
      parentId: asString(source.parentId ?? source.parent_id),
      sourceType,
      source: fileName,
      path: normalizeObjectKey(source.path ?? source.source),
      fileName,
      page: asString(source.page ?? source.page_number),
      pageContent: asString(source.pageContent ?? source.page_content ?? source.content),
      workspaceId: asString(source.workspaceId ?? source.workspace_id ?? source.workspace_name),
      height: asString(source.height),
      width: asString(source.width),
      reference: asString(source.reference),
      highlightText,
      highlightBBox,
      blockBBox,
    };
  }

  return {
    parentId: asString(source.parentId ?? source.parent_id),
    sourceType,
    source: normalizeObjectKey(source.source ?? source.path),
    externalId: asString(source.externalId ?? source.external_id ?? source.source),
    fileName,
    page: asString(source.page ?? source.page_number),
    pageContent: highlightText || asString(source.pageContent ?? source.page_content ?? source.content),
    workspaceId: asString(source.workspaceId ?? source.workspace_id ?? source.workspace_name),
    reference: asString(source.reference),
    highlightText,
    highlightBBox,
    blockBBox,
  };
}

function normalizeCitationComponent(component: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(component.data) ?? component;
  const textSource = asRecord(data.text_source ?? data.textSource);
  const imageSource = asRecord(data.image_source ?? data.imageSource);
  const webSource = asRecord(data.web_source ?? data.webSource);
  const source = webSource ?? textSource ?? imageSource ?? data;

  return {
    ...component,
    type: 'citation',
    data: normalizeCitationData({
      ...source,
      type: webSource ? 'web' : imageSource ? 'image' : source.type,
      parentId: data.parentId ?? data.parent_id ?? source.parentId ?? source.parent_id,
    }),
  };
}

export function normalizePlaybookComponents(
  components: Record<string, unknown>[] | undefined,
  citationSources: unknown,
): Record<string, unknown>[] | undefined {
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
