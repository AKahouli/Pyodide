import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useIsStreaming } from '@openuidev/react-lang';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SingleInlineCitation, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useModuleTranslation } from '@/modules/localization';
import { fetchRootEvidence, fetchSlideExportImage, getCitationViewUrl, getGeneratedImageUrl } from '../../api';
import { ConversationImageActions } from './ConversationImageActions';
import { OpenUiCitationContext, type OpenUiCitationScope, type ScopedImageCache } from './citations';
import type { StockComponent } from './inline-text';

const IMAGE_FIELDS = new Set(['src', 'imageSrc', 'bgImageSrc', 'imagesSrc']);
const DOCUMENT_REFERENCE = /^\[(\d+)\]$/;
const PUBLIC_IMAGE = /^https:\/\//;
export const GENERATED_IMAGE_REFERENCE = /^generated-image:([a-f\d]{24})$/;

/** Owned by one answer provider, never by a module-global or browser-storage cache. */
export function createScopedImageCache(): ScopedImageCache {
  type Image = { blob: Blob; generated: boolean };
  type Entry = { promise: Promise<Image>; image?: Image };
  const entries = new Map<string, Entry>();
  let controller = new AbortController();
  let gate = { active: 0, queue: [] as { start: () => void; cancel: () => void }[] };
  return {
    resolve(key, loader) {
      const existing = entries.get(key);
      if (existing) { entries.delete(key); entries.set(key, existing); return existing.promise; }
      if (entries.size >= 128) return Promise.reject(new Error('Image queue full'));
      const signal = controller.signal;
      const currentGate = gate;
      const promise = new Promise<Image>((resolve, reject) => {
        const start = () => {
          currentGate.active++;
          void Promise.resolve().then(() => { signal.throwIfAborted(); return loader(signal); }).then(resolve, reject).finally(() => {
            currentGate.active--;
            currentGate.queue.shift()?.start();
          });
        };
        if (currentGate.active < 4) start();
        else currentGate.queue.push({ start, cancel: () => reject(new DOMException('Aborted', 'AbortError')) });
      });
      const entry: Entry = { promise };
      entries.set(key, entry);
      void promise.then((image) => {
        if (entries.get(key) !== entry) return;
        entry.image = image;
        let count = 0; let bytes = 0;
        for (const value of entries.values()) if (value.image) { count++; bytes += value.image.blob.size; }
        for (const [candidate, value] of entries) {
          if (count <= 32 && bytes <= 64 * 1024 * 1024) break;
          if (value.image) { entries.delete(candidate); count--; bytes -= value.image.blob.size; }
        }
      }, () => { if (entries.get(key) === entry) entries.delete(key); });
      return promise;
    },
    dispose() {
      controller.abort();
      gate.queue.splice(0).forEach((item) => item.cancel());
      entries.clear();
      controller = new AbortController();
      gate = { active: 0, queue: [] };
    },
    forget(key) { entries.delete(key); },
  };
}

function imageCacheKey(source: string, scope: OpenUiCitationScope, citation?: CitationData) {
  return JSON.stringify([scope.conversationId, scope.messageId, scope.componentId, source, citation]);
}

async function loadPublicImage(source: string, scope: OpenUiCitationScope, signal?: AbortSignal): Promise<Blob> {
  const data = await fetchSlideExportImage(scope.conversationId, scope.messageId, source, signal ?? new AbortController().signal);
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('Invalid image response');
  return new Blob([Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))], { type: match[1] });
}

export async function loadGeneratedImage(source: string, scope: OpenUiCitationScope, signal?: AbortSignal): Promise<Blob> {
  return (await loadGeneratedImageDetails(source, scope, signal)).blob;
}

async function loadGeneratedImageDetails(source: string, scope: OpenUiCitationScope, signal?: AbortSignal): Promise<{ blob: Blob; generated: boolean }> {
  const id = GENERATED_IMAGE_REFERENCE.exec(source)?.[1];
  if (!id) throw new Error('Invalid generated image reference');
  const location = await getGeneratedImageUrl(scope.conversationId, scope.messageId, id, signal);
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(location.mimeType)) throw new Error('Unsupported generated image');
  const response = await fetch(location.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  const { readImage } = await import('./slide-export');
  return { blob: await readImage(response, signal ?? new AbortController().signal), generated: location.generated !== false };
}

export function GeneratedImage({ source, alt, scope, streaming = false }: { source: string; alt: string; scope?: OpenUiCitationScope; streaming?: boolean }) {
  const { t } = useModuleTranslation('conversation');
  const { imageCache: sharedCache } = useContext(OpenUiCitationContext);
  const localCache = useMemo(() => createScopedImageCache(), [scope?.conversationId, scope?.messageId, scope?.componentId]);
  useEffect(() => () => localCache.dispose(), [localCache]);
  const imageCache = sharedCache ?? localCache;
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([source, scope?.conversationId, scope?.messageId]);
  const [state, setState] = useState<{ key: string; url?: string; generated?: boolean; failed?: boolean }>({ key: '' });
  useEffect(() => {
    if (streaming || !scope) return;
    let disposed = false;
    let url: string | undefined;
    void imageCache.resolve(imageCacheKey(source, scope), (signal) => loadGeneratedImageDetails(source, scope, signal)).then(({ blob, generated }) => {
      if (disposed) return;
      url = URL.createObjectURL(blob); setState({ key, url, generated });
    }).catch(() => { if (!disposed) setState({ key, failed: true }); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [source, scope?.conversationId, scope?.messageId, streaming, imageCache, retry]);
  const ready = !streaming && state.key === key && state.url;
  const failed = state.key === key && state.failed;
  return <span className='inline-flex max-w-full flex-col gap-2'>
    {ready ? <><img src={state.url} alt={alt} className='h-auto max-h-96 w-auto max-w-full rounded-lg object-contain' /><GeneratedImageLinks url={state.url!} generated={state.generated} /></>
      : <span role={failed || !scope ? 'alert' : 'status'}>{t(failed || !scope ? 'openui.image.unavailable' : 'openui.image.loading')}</span>}
    {!streaming && scope && state.key === key && state.failed && <Button variant='outline' size='sm' onClick={() => { setState({ key }); setRetry((value) => value + 1); }}>{t('home.retry')}</Button>}
  </span>;
}

function GeneratedImageLinks({ url, generated = true, download = true }: { url: string; generated?: boolean; download?: boolean }) {
  const { t } = useModuleTranslation('conversation');
  return <span className='inline-flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
    {generated && <span>{t('openui.image.generated')}</span>}
    <a href={url} target='_blank' rel='noreferrer' className='underline'>{t('openui.image.preview')}</a>
    {download && <a href={url} download='generated-image.png' className='underline'>{t('openui.image.download')}</a>}
  </span>;
}

/** Only image fields are rewritten; citation markers in captions and other prose stay intact. */
export function mapImageSources(value: unknown, replace: (source: string) => string, field = ''): unknown {
  if (typeof value === 'string') return IMAGE_FIELDS.has(field) ? replace(value) : value;
  if (Array.isArray(value)) return value.map((item) => mapImageSources(item, replace, field));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapImageSources(item, replace, key)]));
  }
  return value;
}

export async function loadDocumentImage(citation: CitationData, scope: OpenUiCitationScope, signal?: AbortSignal): Promise<Blob> {
  if (citation.sourceType === 'web' || citation.sourceType === 'record') throw new Error('Not a document citation');
  const owned = citation.evidenceId !== undefined || citation.executionId !== undefined;
  if (owned && (typeof citation.evidenceId !== 'string' || !citation.evidenceId.trim()
    || typeof citation.executionId !== 'string' || !citation.executionId.trim())) throw new Error('Incomplete document evidence identity');
  const location = owned
    ? await fetchRootEvidence(scope.conversationId, citation.executionId!, citation.evidenceId!, signal)
    : await getCitationViewUrl(scope.conversationId, scope.messageId, {
      source: citation.sourceType === 'image' ? citation.path || citation.source : citation.source,
      fileName: citation.fileName,
      reference: citation.reference,
    }, signal);
  signal?.throwIfAborted();
  if (('kind' in location && location.kind !== 'citation') || !('url' in location) || !location.url) throw new Error('No document image location');
  const mimeType = location.mimeType?.split(';')[0];
  if (mimeType === 'application/pdf') {
    const { renderPdfImage } = await import('./pdf-image');
    const page = Number(citation.page.match(/\d+/g)?.at(-1) ?? 1);
    const blob = await renderPdfImage(location.url, page, citation.highlightBBox ?? citation.blockBBox, signal);
    signal?.throwIfAborted();
    return blob;
  }
  if (!mimeType?.startsWith('image/')) throw new Error('Unsupported document image');
  // The URL comes from the authorized citation resolver, never from a model-authored storage key.
  const response = await fetch(location.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  const { readImage } = await import('./slide-export');
  return readImage(response, signal ?? new AbortController().signal);
}

/** Resolves document references for every stock image layout, including nested card/list images. */
export function withDocumentImages(Stock: StockComponent, name: string): StockComponent {
  return function DocumentImages(args) {
    const { byReference, scope, imageCache: sharedCache } = useContext(OpenUiCitationContext);
    const localCache = useMemo(() => createScopedImageCache(), [scope?.conversationId, scope?.messageId, scope?.componentId]);
    useEffect(() => () => localCache.dispose(), [localCache]);
    const imageCache = sharedCache ?? localCache;
    const streaming = useIsStreaming();
    const { t } = useModuleTranslation('conversation');
    const references = new Set<string>();
    mapImageSources(args.props, (source) => {
      const reference = DOCUMENT_REFERENCE.exec(source)?.[1] ?? (GENERATED_IMAGE_REFERENCE.test(source) || (Boolean(scope) && PUBLIC_IMAGE.test(source)) ? source : undefined);
      if (reference) references.add(reference);
      return source;
    });
    const citations = [...references].map((reference) => byReference.get(reference));
    const requestKey = JSON.stringify([scope, [...references], citations]);
    const container = useRef<HTMLDivElement>(null);
    const [actionsAllowed, setActionsAllowed] = useState(false);
    const session = useRef<{ retry: (reference: string) => void; fail: (reference: string) => void }>();
    const [state, setState] = useState<{ key: string; urls: Map<string, string>; generated: Set<string>; failed: Set<string>; pending: boolean }>({ key: '', urls: new Map(), generated: new Set(), failed: new Set(), pending: true });
    const loadImage = useCallback((source: string) => {
      if (!scope) return Promise.reject(new Error('Missing image scope'));
      const reference = DOCUMENT_REFERENCE.exec(source)?.[1] ?? source;
      const citation = byReference.get(reference);
      return imageCache.resolve(imageCacheKey(reference, scope, citation), async (signal) => {
        if (GENERATED_IMAGE_REFERENCE.test(reference)) return loadGeneratedImageDetails(reference, scope, signal);
        if (PUBLIC_IMAGE.test(reference)) return { blob: await loadPublicImage(reference, scope, signal), generated: false };
        if (!citation) throw new Error('Unknown document citation');
        return { blob: await loadDocumentImage(citation, scope, signal), generated: false };
      });
    }, [scope?.conversationId, scope?.messageId, scope?.componentId, byReference, imageCache]);

    useEffect(() => {
      if (references.size === 0 || streaming) return;
      let disposed = false;
      const urls = new Map<string, string>();
      const generated = new Set<string>();
      const failures = new Set<string>();
      const pending = new Set<string>();
      const publish = () => { if (!disposed) setState({ key: requestKey, urls: new Map(urls), generated: new Set(generated), failed: new Set(failures), pending: pending.size > 0 }); };
      const run = (requested: string[]) => {
        for (const reference of requested) { failures.delete(reference); pending.add(reference); }
        publish();
        for (const reference of requested) {
          void loadImage(reference).then((image) => {
            if (disposed) return;
            urls.set(reference, URL.createObjectURL(image.blob));
            if (image.generated) generated.add(reference);
          }).catch(() => { if (!disposed) failures.add(reference); }).finally(() => {
            pending.delete(reference); publish();
          });
        }
      };
      session.current = {
        retry: (reference) => { if (failures.has(reference) && !pending.has(reference)) run([reference]); },
        fail: (reference) => {
          const url = urls.get(reference);
          if (!url) return;
          URL.revokeObjectURL(url); urls.delete(reference); failures.add(reference);
          if (scope) imageCache.forget(imageCacheKey(reference, scope, byReference.get(reference)));
          publish();
        },
      };
      run([...references]);
      return () => {
        disposed = true;
        session.current = undefined;
        urls.forEach((url) => URL.revokeObjectURL(url));
      };
      // Source metadata changes invalidate the view; failed retries preserve successful URLs.
    }, [requestKey, streaming, imageCache]);

    const resolveImage = useCallback(async (source: string) => (await loadImage(source)).blob, [loadImage]);
    // Slide thumbnails are themselves buttons. Only the full preview may host
    // interactive controls, preventing nested buttons and accidental navigation.
    useEffect(() => { setActionsAllowed(Boolean(container.current && !container.current.closest('button'))); }, [requestKey]);

    if (references.size === 0) return <Stock {...args} />;
    const failed = state.key === requestKey && state.failed.size > 0;
    const ready = !streaming && state.key === requestKey && state.urls.size > 0;
    const pending = !streaming && (state.key !== requestKey || state.pending);
    const props = mapImageSources(args.props, (source) => {
      const reference = DOCUMENT_REFERENCE.exec(source)?.[1] ?? (GENERATED_IMAGE_REFERENCE.test(source) || (Boolean(scope) && PUBLIC_IMAGE.test(source)) ? source : undefined);
      return reference ? ready ? state.urls.get(reference) ?? '' : '' : source;
    }) as typeof args.props;
    // A failed slot already has a labeled retry above; do not render a broken img.
    if (name === 'ImageGallery' && Array.isArray(props.imagesSrc)) {
      const visible = props.imagesSrc.map((source: string, index: number) => ({ source, index })).filter(({ source }: { source: string }) => Boolean(source));
      props.imagesSrc = visible.map(({ source }: { source: string }) => source);
      if (Array.isArray(props.imagesAlt)) props.imagesAlt = visible.map(({ index }: { index: number }) => props.imagesAlt[index]);
    }
    const referenceLabel = (reference: string) => {
      const sources = Array.isArray(args.props.imagesSrc) ? args.props.imagesSrc : [];
      const sourceIndex = sources.findIndex((source) => typeof source === 'string' && (DOCUMENT_REFERENCE.exec(source)?.[1] ?? source) === reference);
      const index = sourceIndex >= 0 ? sourceIndex : [...references].indexOf(reference);
      const alt = Array.isArray(args.props.imagesAlt) ? args.props.imagesAlt[index] : args.props.alt;
      return typeof alt === 'string' && alt.trim() ? alt : byReference.get(reference)?.fileName || t('openui.image.actions.savedImage', { index: index + 1 });
    };
    return (
      <div ref={container} data-openui-document-image='' className='min-w-0 space-y-2 [&_.openui-gallery>div]:!max-h-none [&_.openui-gallery_img]:!object-contain [&_.openui-gallery_img]:!transform-none'>
        {(!ready || failed || pending) && (
          <div role={failed ? undefined : 'status'} className='flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground'>
            {failed ? [...state.failed].map((reference) => <div key={reference} role='alert' aria-label={referenceLabel(reference)} className='flex flex-wrap items-center justify-center gap-2'>
              <span className='break-words'>{referenceLabel(reference)}: {t('openui.image.unavailable')}</span>
              {actionsAllowed && <Button variant='outline' size='sm' disabled={pending} onClick={() => session.current?.retry(reference)}>{t('home.retry')}</Button>}
            </div>)
              : <><Loader2 className='size-4 animate-spin motion-reduce:animate-none' aria-hidden='true' /><span>{t('openui.image.loading')}</span></>}
          </div>
        )}
        {ready && (
          <div className={['Image', 'ImageBlock', 'ImageGallery'].includes(name) ? 'max-w-3xl' : undefined} onErrorCapture={(event) => {
            const failedReference = event.target instanceof HTMLImageElement ? [...state.urls].find(([, url]) => url === (event.target as HTMLImageElement).src)?.[0] : undefined;
            if (failedReference) session.current?.fail(failedReference);
          }}>
            {name === 'Image' || name === 'ImageBlock'
              ? <img src={props.src} alt={props.alt ?? ''} className='h-auto max-h-96 w-auto max-w-full rounded-lg object-contain' />
              // Stock galleries retain their initial image list internally. Refresh that
              // view when a failed slot resolves, keeping every successful blob URL.
              : <Stock key={JSON.stringify([...state.urls])} {...args} props={props} />}
          </div>
        )}
        {actionsAllowed && <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
          {[...references].filter((reference) => GENERATED_IMAGE_REFERENCE.test(reference)).map((reference) => state.key === requestKey && state.urls.get(reference)
            ? <GeneratedImageLinks key={reference} url={state.urls.get(reference)!} generated={state.generated.has(reference)} download={false} /> : null)}
          {citations.map((citation, index) => citation && <span key={index} className='inline-flex items-center gap-1'>
            <span>{citation.fileName || citation.source.split('/').at(-1)}{citation.page ? ` · ${t('openui.image.page', { page: citation.page })}` : ''}</span>
            <SingleInlineCitation citation={citation} citationScope={scope} />
          </span>)}
        </div>}
        {ready && actionsAllowed && scope && [...references].map((reference, index) => {
          if (!state.urls.has(reference)) return null;
          const source = /^\d+$/.test(reference) ? `[${reference}]` : reference;
          const label = typeof args.props.alt === 'string' ? args.props.alt : Array.isArray(args.props.imagesAlt) && typeof args.props.imagesAlt[index] === 'string' ? args.props.imagesAlt[index] : t('openui.image.actions.savedImage', { index: index + 1 });
          return <ConversationImageActions key={reference} source={source} alt={label} scope={scope}
            url={state.urls.get(reference)} streaming={streaming} resolveImage={resolveImage}
            peers={[...references].map((entry, peerIndex) => ({ source: /^\d+$/.test(entry) ? `[${entry}]` : entry,
              label: Array.isArray(args.props.imagesAlt) && typeof args.props.imagesAlt[peerIndex] === 'string' ? args.props.imagesAlt[peerIndex] : t('openui.image.actions.savedImage', { index: peerIndex + 1 }) }))} />;
        })}
      </div>
    );
  };
}
