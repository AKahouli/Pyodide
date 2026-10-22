import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationSource,
  InlineCitationQuote,
} from '@/components/ai-elements/inline-citation';
import { MessageProvider, useFileViewerDisplayMode } from '@/components/ai-elements/message-context';
import { openCitationSource, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useModuleTranslation } from '@/modules/localization';
import { rehypeCitationMarkers } from '@/lib/rehype-citation-markers';
import type { EvaluationCitation } from '../types';

/** The signed-url endpoint expects a Ceph object key (`{ownerId}/{prefix}/{file}`),
 *  not an `s3://<bucket>/<key>` URI. Strip the scheme + bucket when present. */
function toObjectKey(source: string): string {
  const match = /^s3:\/\/[^/]+\/(.*)$/.exec(source);
  return match ? match[1] : source;
}

function toCitationData(citation: EvaluationCitation): CitationData {
  return {
    parentId: '',
    sourceType: 'text',
    source: toObjectKey(citation.source ?? citation.fileName),
    fileName: citation.fileName,
    externalId: '',
    page: citation.page != null ? String(citation.page) : '',
    pageContent: citation.snippet,
    workspaceId: '',
    reference: String(citation.reference),
    highlightText: citation.snippet,
    exactText: citation.snippet,
  };
}

function CitationBadge({ citation }: { citation: CitationData }) {
  const { t } = useModuleTranslation('evaluation-logical-search');
  const displayMode = useFileViewerDisplayMode();
  const handleClick = () => {
    void openCitationSource(citation, displayMode, citation.fileName ?? String(citation.reference ?? '')).catch(() => {
      toast.error(t('results.citations.openError'));
    });
  };
  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger
          sources={[String(citation.reference ?? '')]}
          className='cursor-pointer'
          onClick={handleClick}
        />
        <InlineCitationCardBody>
          <InlineCitationCarousel>
            <InlineCitationCarouselContent>
              <InlineCitationCarouselItem>
                <InlineCitationSource
                  title={citation.fileName || String(citation.reference ?? '')}
                  description={citation.page ? t('results.citations.page', { page: citation.page }) : undefined}
                />
                {citation.pageContent && <InlineCitationQuote>{citation.pageContent}</InlineCitationQuote>}
              </InlineCitationCarouselItem>
            </InlineCitationCarouselContent>
          </InlineCitationCarousel>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}

/** Renders the generated answer, turning `[n]` markers into clickable citations. */
export function EvaluationAnswerWithCitations({
  content,
  citations,
}: {
  content: string;
  citations: EvaluationCitation[];
}): JSX.Element {
  const map = new Map(citations.map((citation) => [String(citation.reference), toCitationData(citation)]));
  const components = {
    // `cite` nodes come from rehypeCitationMarkers (one per `[n]` marker).
    cite: ({ node, ...props }: { node?: unknown; [key: string]: unknown }) => {
      void node;
      const ref = props['data-citation-ref'] as string | undefined;
      if (ref == null) return null;
      const citation = map.get(ref);
      if (!citation) return <span>[{ref}]</span>;
      return <CitationBadge citation={citation} />;
    },
  };
  return (
    <MessageProvider fileViewerDisplayMode='floating'>
      <div className='text-sm leading-relaxed [&_p]:my-2'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeCitationMarkers]}
          components={components as never}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MessageProvider>
  );
}
