import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { semanticModelApi } from '../../api';
import type { SourceMappingPreviewDraft, SourceMappingPreviewResponse, StructuredSourceAsset } from '../../types';

/** How long after the last rule edit the shown document is read again. */
export const LIVE_PREVIEW_DELAY_MS = 700;
// A document switch has no typing to wait for.
const SWITCH_DELAY_MS = 150;

type LiveDraft = Omit<SourceMappingPreviewDraft, 'workspaceId' | 'documentId' | 'assetKind'>;

interface LiveResult {
  documentId: string;
  result: SourceMappingPreviewResponse;
  /** Each field's mapping as it was read, to tell which fields changed since. */
  fields: Record<string, string>;
}

function fieldSnapshot(draft: LiveDraft) {
  return Object.fromEntries(draft.fieldMappings.map((mapping) => [mapping.targetAttribute, JSON.stringify(mapping)]));
}

/**
 * Reads the shown document with the current rules, again shortly after each edit or document switch.
 * Only the answer to the latest request is kept; an older one arriving late is ignored. With `auto`
 * off (fields read by AI, which is slow and costly), it reads only when `run` is called.
 */
export function useLiveDocumentPreview({ modelId, asset, draft, enabled, auto }: Readonly<{
  modelId: string;
  asset?: StructuredSourceAsset;
  draft: LiveDraft | null;
  enabled: boolean;
  auto: boolean;
}>) {
  const [last, setLast] = useState<LiveResult | null>(null);
  const [failure, setFailure] = useState<{ documentId: string; error: unknown } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const request = useRef(0);
  const key = enabled && asset && draft ? JSON.stringify([asset.workspaceId, asset.documentId, draft]) : '';
  const latest = useRef({ asset, draft });
  latest.current = { asset, draft };

  const run = useCallback(async () => {
    const { asset: target, draft: body } = latest.current;
    if (!target || !body) return;
    const id = ++request.current;
    setWaiting(true);
    setFailure(null);
    try {
      const result = await semanticModelApi.previewSourceMapping(modelId, {
        ...body, workspaceId: target.workspaceId, documentId: target.documentId, assetKind: 'document',
      });
      if (id !== request.current) return;
      setLast({ documentId: target.documentId, result, fields: fieldSnapshot(body) });
    } catch (caught) {
      if (id !== request.current) return;
      setFailure({ documentId: target.documentId, error: caught });
    } finally {
      if (id === request.current) setWaiting(false);
    }
  }, [modelId]);

  const shownId = asset?.documentId;
  const switched = last?.documentId !== shownId;
  useEffect(() => {
    // Whatever is in flight was asked with other rules or for another document.
    request.current += 1;
    if (!key || !auto) { setWaiting(false); return; }
    setWaiting(true);
    const timer = globalThis.setTimeout(() => void run(), switched ? SWITCH_DELAY_MS : LIVE_PREVIEW_DELAY_MS);
    return () => globalThis.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  const current = last && !switched ? last : null;
  // Fields whose rules changed since the shown result was read.
  const changed = useMemo(() => {
    if (!current || !draft) return new Set<string>();
    const now = fieldSnapshot(draft);
    return new Set(Object.keys(now).filter((field) => now[field] !== current.fields[field]));
  }, [current, draft]);

  return {
    /** The result for the shown document, or null before its first read. */
    result: current?.result ?? null,
    error: failure && failure.documentId === shownId ? failure.error : null,
    /** A read is waiting for the edits to settle, or running. */
    reading: waiting,
    changed,
    run,
  };
}
