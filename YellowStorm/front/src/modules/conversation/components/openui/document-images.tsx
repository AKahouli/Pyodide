import { useContext, useEffect, useState } from 'react';
import { useIsStreaming } from '@openuidev/react-lang';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SingleInlineCitation, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useModuleTranslation } from '@/modules/localization';
import { fetchRootEvidence, getCitationViewUrl } from '../../api';
import { OpenUiCitationContext, type OpenUiCitationScope } from './citations';
import type { StockComponent } from './inline-text';

const IMAGE_FIELDS = new Set(['src', 'imageSrc', 'bgImageSrc', 'imagesSrc']);
const DOCUMENT_REFERENCE = /^\[(\d+)\]$/;

/** Only image fields are rewritten; citation markers in captions and other prose stay intact. */
export function mapImageSources(value: unknown, replace: (source: string) => string, field = ''): unknown {
  if (typeof value === 'string') return IMAGE_FIELDS.has(field) ? replace(value) : value;
  if (Array.isArray(value)) return value.map((item) => mapImageSources(item, replace, field));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapImageSources(item, replace, key)]));
  }
  return value;
}

async function loadDocumentImage(citation: CitationData, scope: OpenUiCitationScope): Promise<Blob> {
  if (citation.sourceType === 'web' || citation.sourceType === 'record') throw new Error('Not a document citation');
  const owned = citation.evidenceId !== undefined || citation.executionId !== undefined;
  if (owned && (typeof citation.evidenceId !== 'string' || !citation.evidenceId.trim()
    || typeof citation.executionId !== 'string' || !citation.executionId.trim())) throw new Error('Incomplete document evidence identity');
  const location = owned
    ? await fetchRootEvidence(scope.conversationId, citation.executionId!, citation.evidenceId!)
    : await getCitationViewUrl(scope.conversationId, scope.messageId, {
      source: citation.sourceType === 'image' ? citation.path || citation.source : citation.source,
      fileName: citation.fileName,
      reference: citation.reference,
    });
  if (('kind' in location && location.kind !== 'citation') || !('url' in location) || !location.url) throw new Error('No document image location');
  const mimeType = location.mimeType?.split(';')[0];
  if (mimeType === 'application/pdf') {
    const { renderPdfImage } = await import('./pdf-image');
    const page = Number(citation.page.match(/\d+/g)?.at(-1) ?? 1);
    return renderPdfImage(location.url, page, citation.highlightBBox ?? citation.blockBBox);
  }
  if (!mimeType?.startsWith('image/')) throw new Error('Unsupported document image');
  // The URL comes from the authorized citation resolver, never from a model-authored storage key.
  const response = await fetch(location.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Document image unavailable');
  return new Blob([await response.arrayBuffer()], { type: mimeType });
}

/** Resolves document references for every stock image layout, including nested card/list images. */
export function withDocumentImages(Stock: StockComponent, name: string): StockComponent {
  return function DocumentImages(args) {
    const { byReference, scope } = useContext(OpenUiCitationContext);
    const streaming = useIsStreaming();
    const { t } = useModuleTranslation('conversation');
    const references = new Set<string>();
    mapImageSources(args.props, (source) => {
      const reference = DOCUMENT_REFERENCE.exec(source)?.[1];
      if (reference) references.add(reference);
      return source;
    });
    const citations = [...references].map((reference) => byReference.get(reference));
    const requestKey = JSON.stringify([scope, [...references], citations]);
    const [retry, setRetry] = useState(0);
    const [state, setState] = useState<{ key: string; urls: Map<string, string>; error?: boolean }>({ key: '', urls: new Map() });

    useEffect(() => {
      if (references.size === 0 || streaming) return;
      let disposed = false;
      const urls = new Map<string, string>();
      setState({ key: requestKey, urls: new Map() });
      void Promise.allSettled([...references].map(async (reference) => {
        const citation = byReference.get(reference);
        if (!citation || !scope) throw new Error('Unknown document citation');
        const blob = await loadDocumentImage(citation, scope);
        if (!disposed) urls.set(reference, URL.createObjectURL(blob));
      })).then((results) => {
        if (!disposed) setState({ key: requestKey, urls, error: results.some((result) => result.status === 'rejected') });
      });
      return () => {
        disposed = true;
        urls.forEach((url) => URL.revokeObjectURL(url));
      };
      // requestKey includes scope, references and all source metadata; streamed prose does not refetch images.
    }, [requestKey, streaming, retry]);

    if (references.size === 0) return <Stock {...args} />;
    const failed = state.key === requestKey && state.error;
    const ready = !streaming && state.key === requestKey && state.urls.size === references.size && !failed;
    const props = mapImageSources(args.props, (source) => {
      const reference = DOCUMENT_REFERENCE.exec(source)?.[1];
      return reference ? state.urls.get(reference) ?? '' : source;
    }) as typeof args.props;
    return (
      <div data-openui-document-image='' className='min-w-0 space-y-2 [&_.openui-gallery>div]:!max-h-none [&_.openui-gallery_img]:!object-contain [&_.openui-gallery_img]:!transform-none'>
        {!ready ? (
          <div role={failed ? 'alert' : 'status'} className='flex min-h-32 items-center justify-center gap-2 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground'>
            {failed ? <><span>{t('openui.image.unavailable')}</span><Button variant='outline' size='sm' onClick={() => setRetry((value) => value + 1)}>{t('home.retry')}</Button></>
              : <><Loader2 className='size-4 animate-spin motion-reduce:animate-none' aria-hidden='true' /><span>{t('openui.image.loading')}</span></>}
          </div>
        ) : (
          <div className={['Image', 'ImageBlock', 'ImageGallery'].includes(name) ? 'max-w-3xl' : undefined} onErrorCapture={(event) => {
            if (event.target instanceof HTMLImageElement && [...state.urls.values()].includes(event.target.src)) {
              setState((value) => ({ ...value, error: true }));
            }
          }}>
            {name === 'Image' || name === 'ImageBlock'
              ? <img src={props.src} alt={props.alt ?? ''} className='h-auto max-h-96 w-auto max-w-full rounded-lg object-contain' />
              : <Stock {...args} props={props} />}
          </div>
        )}
        <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
          {citations.map((citation, index) => citation && <span key={index} className='inline-flex items-center gap-1'>
            <span>{citation.fileName || citation.source.split('/').at(-1)}{citation.page ? ` · ${t('openui.image.page', { page: citation.page })}` : ''}</span>
            <SingleInlineCitation citation={citation} citationScope={scope} />
          </span>)}
        </div>
      </div>
    );
  };
}
