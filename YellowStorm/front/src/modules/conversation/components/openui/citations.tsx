import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { MarkDownRenderer, useTheme } from '@openuidev/react-ui';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { SingleInlineCitation, type CitationData } from '@/components/ai-elements/ai-message-content';
import { rehypeCitationMarkers } from '@/lib/rehype-citation-markers';
import { remarkAssistantCitationLinks } from '@/lib/remark-assistant-citation-links';

export interface OpenUiCitationScope {
  conversationId: string;
  messageId: string;
}

interface OpenUiCitationContextValue {
  /** Citations of the answer keyed by their bare reference ("1" for a `[1]` marker). */
  byReference: ReadonlyMap<string, CitationData>;
  scope?: OpenUiCitationScope;
}

const EMPTY: OpenUiCitationContextValue = { byReference: new Map() };

export const OpenUiCitationContext = createContext<OpenUiCitationContextValue>(EMPTY);

/** The same reference normalisation the markdown renderer uses ("[1]" and " 1 " both give "1"). */
function bareReference(reference?: string): string | undefined {
  return reference?.trim().replace(/^\[|\]$/g, '').trim() || undefined;
}

export interface SplitCitations {
  byReference: Map<string, CitationData>;
  /** Citations the text never marks: shown after the answer, as the markdown renderer does. */
  trailing: CitationData[];
}

/** Same split as the markdown renderer: a citation is inline when its `[n]` marker is in the text. */
export function splitCitations(citations: readonly CitationData[] | undefined, content: string, scope?: OpenUiCitationScope): SplitCitations {
  const byReference = new Map<string, CitationData>();
  const trailing: CitationData[] = [];
  for (const citation of citations ?? []) {
    const reference = bareReference(citation.reference);
    // The first citation of a reference wins the marker; a repeat is treated as unmarked, so it is not lost.
    if (reference && !byReference.has(reference) && content.includes(`[${reference}]`)) byReference.set(reference, citation);
    // Owned evidence that the text does not mark stays in the Sources menu, not after the answer.
    else if (!scope || !citation.evidenceId || !citation.executionId) trailing.push(citation);
  }
  return { byReference, trailing };
}

/** `[n]` marker -> our citation chip (hover card plus the document viewer); unknown markers stay literal text. */
function CitationMarker(props: { 'data-citation-ref'?: string }) {
  const { byReference, scope } = useContext(OpenUiCitationContext);
  const reference = props['data-citation-ref'];
  if (reference == null) return null;
  const citation = byReference.get(reference);
  if (!citation) return <>[{reference}]</>;
  return (
    <span data-citation-ref={reference}>
      <SingleInlineCitation citation={citation} citationScope={scope} />
    </span>
  );
}

const REMARK_PLUGINS = [remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkAssistantCitationLinks];
const MARKDOWN_COMPONENTS = { cite: CitationMarker };
const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
/** Same flattening as the stock `InlineMarkdownRenderer`: block elements collapse so the output stays inline. */
const INLINE_MARKDOWN_COMPONENTS = { cite: CitationMarker, p: Passthrough, h1: Passthrough, h2: Passthrough, h3: Passthrough, h4: Passthrough, h5: Passthrough, h6: Passthrough, ul: Passthrough, ol: Passthrough, li: Passthrough };

/**
 * The stock markdown block (`openui-markdown-renderer`) plus our citation chips.
 * Every prose component of the library that renders markdown goes through this.
 */
export function CitationMarkdown({ textMarkdown, variant, className, inline }: Readonly<{ textMarkdown: string; variant?: 'clear' | 'card' | 'sunk'; className?: string; inline?: boolean }>) {
  const { byReference } = useContext(OpenUiCitationContext);
  const options = useMemo(() => ({
    remarkPlugins: REMARK_PLUGINS as never,
    rehypePlugins: (byReference.size > 0 ? [rehypeKatex, rehypeCitationMarkers] : [rehypeKatex]) as never,
    components: (inline ? INLINE_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS) as never,
  }), [byReference.size, inline]);
  return (
    <MarkDownRenderer
      textMarkdown={textMarkdown}
      variant={variant}
      options={options}
      className={className}
    />
  );
}

/** Plain-text props (titles, subtitles): known `[n]` markers become chips, everything else is left as written. */
export function CitationText({ text }: Readonly<{ text: string }>) {
  const { byReference } = useContext(OpenUiCitationContext);
  if (byReference.size === 0) return <>{text}</>;
  return (
    <>
      {text.split(/(\[\d+\])/).map((chunk, index) => {
        const reference = /^\[(\d+)\]$/.exec(chunk)?.[1];
        return reference && byReference.has(reference) ? <CitationMarker key={index} data-citation-ref={reference} /> : chunk;
      })}
    </>
  );
}

/** True when a string carries a marker with a known citation, i.e. when it is worth wrapping. */
export function hasKnownMarker(value: unknown, byReference: ReadonlyMap<string, CitationData>): value is string {
  if (typeof value !== 'string' || byReference.size === 0) return false;
  return Array.from(value.matchAll(/\[(\d+)\]/g)).some((match) => byReference.has(match[1]));
}

export interface StockSource { title: string; sourceName: string; url?: string }

const MAX_STOCK_SOURCES = 999;

/**
 * Stock markdown paths that parse `[n]` themselves (inline headers, text blocks) show a source
 * widget from this list instead of dropping the marker. It is a fallback: it opens web sources only.
 */
export function toStockSources(byReference: ReadonlyMap<string, CitationData>): StockSource[] {
  const byIndex = new Map<number, StockSource>();
  byReference.forEach((citation, reference) => {
    const index = Number(reference);
    // Stock markers are 1-based numbers; anything else cannot be addressed through them.
    if (!Number.isSafeInteger(index) || index < 1 || index > MAX_STOCK_SOURCES) return;
    const title = citation.title || citation.fileName || citation.record?.name || citation.source.split(/[\\/]/).filter(Boolean).at(-1) || reference;
    const isWeb = /^https?:\/\//i.test(citation.source) && URL.canParse(citation.source);
    byIndex.set(index, { title, sourceName: isWeb ? new URL(citation.source).hostname : title, ...(isWeb ? { url: citation.source } : {}) });
  });
  const last = Math.max(0, ...byIndex.keys());
  // Dense on purpose: gaps (markers [1] and [3]) get a blank entry, which the stock citation renderer filters out.
  return Array.from({ length: last }, (_unused, position) => byIndex.get(position + 1) ?? { title: '', sourceName: '' });
}

/**
 * The thesys prose block (`div.c1-text-content` around a `c1-markdown-renderer`), with citation chips.
 * Used for TextContent and for the details of a step. The stock block ignores TextContent's `size`, so this does too.
 */
export function CitedProse({ text }: Readonly<{ text: string }>) {
  const { mode } = useTheme();
  return (
    <div className='c1-text-content'>
      <CitationMarkdown textMarkdown={text} className={cn('c1-markdown-renderer', { 'c1-markdown-renderer-dark-mode': mode === 'dark' })} />
    </div>
  );
}

/** Renderer for the library's `TextContent`. */
export function OpenUiTextContent({ props }: Readonly<{ props: { text?: unknown } }>) {
  return <CitedProse text={props.text == null ? '' : String(props.text)} />;
}

/**
 * True when the string has a `[n]` marker and the answer has citations at all. The stock components
 * silently drop a marker they have no source for, so any marker in a cited answer is routed through
 * ours, which shows an unknown one as literal text.
 */
export function hasMarker(value: unknown, byReference: ReadonlyMap<string, CitationData>): value is string {
  return typeof value === 'string' && byReference.size > 0 && /\[\d+\]/.test(value);
}
