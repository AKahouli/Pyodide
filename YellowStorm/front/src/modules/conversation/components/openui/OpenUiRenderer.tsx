import './devtools-off';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Renderer, type ActionEvent, type ParseResult } from '@openuidev/react-lang';
import { CardSourceProvider, ThemeProvider } from '@openuidev/react-ui';
import '@openuidev/react-ui/styles/index.css';
import '@openuidev/thesys/styles.css';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { CitationsInline, type CitationData } from '@/components/ai-elements/ai-message-content';
import { OpenUiCitationContext, splitCitations, toStockSources, type OpenUiCitationScope } from './citations';
import { openUiLibrary } from './library';
import { ReportBlock } from './ReportBlock';
import { splitReportProgram } from './report-program';
import { OPENUI_COMPACT_THEME } from './theme';
import { createScopedImageCache } from './document-images';

export interface OpenUiRendererProps {
  content: string;
  isStreaming: boolean;
  onAction: (event: ActionEvent) => void;
  citations?: CitationData[];
  citationScope?: OpenUiCitationScope;
  /**
   * Shown instead of a program once the answer is complete and still has no renderable root. A function
   * receives the text of the program it replaces (the chat part when a report follows it).
   */
  fallback?: ReactNode | ((text: string) => ReactNode);
  /** Tags the scope with the stored text component it renders (see plain-text.ts). */
  partId?: string;
  initialState?: Record<string, unknown>;
  onStateUpdate?: (state: Record<string, unknown>) => void;
}

/** Scope for the `--openui-*` theme tokens, so ThemeProvider does not write onto <body>. */
const THEME_SCOPE_ATTRIBUTE = 'data-openui-scope';

/** The app theme setting may be "system"; OpenUI only knows light and dark. */
export function resolveOpenUiMode(theme: string): 'light' | 'dark' {
  if (theme === 'system') return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return theme === 'light' ? 'light' : 'dark';
}

/**
 * Loaded lazily (see OpenUiAnswer): this is the only module that imports the
 * OpenUI runtime, component library and its stylesheet.
 */
export default function OpenUiRenderer({ content, isStreaming, onAction, citations, citationScope, fallback, partId, initialState, onStateUpdate }: Readonly<OpenUiRendererProps>) {
  const { theme } = useContext(ThemeProviderContext);
  const mode = resolveOpenUiMode(theme);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [reportParsed, setReportParsed] = useState<ParseResult | null>(null);
  const { chat, report } = useMemo(() => splitReportProgram(content), [content]);
  const { byReference, trailing } = useMemo(() => splitCitations(citations, content, citationScope), [citations, content, citationScope]);
  const stockSources = useMemo(() => toStockSources(byReference), [byReference]);
  const imageCache = useMemo(() => createScopedImageCache(), [citationScope?.conversationId, citationScope?.messageId, citationScope?.componentId, partId]);
  useEffect(() => () => imageCache.dispose(), [imageCache]);
  const citationValue = useMemo(() => ({ byReference, scope: citationScope, imageCache }), [byReference, citationScope, imageCache]);
  const reportCitations = useMemo(() => Array.from(byReference).filter(([reference]) => report?.includes(`[${reference}]`) && !chat.includes(`[${reference}]`)).map(([, citation]) => citation), [byReference, report, chat]);
  const hasChat = chat.trim() !== '';
  // While streaming, partial or invalid text must never swap the view: only a
  // finished answer that never produced a root falls back to the markdown view.
  const unrenderable = (outcome: ParseResult | null) => !isStreaming && fallback !== undefined && outcome !== null && outcome.root === null;
  // A report-only answer falls back as a whole; with a chat program, only the chat falls back and the report chip stays.
  const wholeFallback = !hasChat && report !== null && unrenderable(reportParsed);
  const chatFallback = hasChat && unrenderable(parsed);
  const renderFallback = (text: string) => (typeof fallback === 'function' ? fallback(text) : fallback);
  return (
    <div {...{ [THEME_SCOPE_ATTRIBUTE]: '' }} data-openui-part={partId} data-testid='openui-answer' className='min-w-0'>
      <ThemeProvider mode={mode} lightTheme={OPENUI_COMPACT_THEME} darkTheme={OPENUI_COMPACT_THEME} cssSelector={`[${THEME_SCOPE_ATTRIBUTE}]`}>
        <OpenUiCitationContext.Provider value={citationValue}>
          <CardSourceProvider sources={stockSources}>
            {wholeFallback ? renderFallback(content) : (
              <>
                {hasChat && (chatFallback
                  ? renderFallback(chat)
                  : <Renderer response={chat} library={openUiLibrary} isStreaming={isStreaming} onAction={onAction} onParseResult={setParsed} initialState={initialState} onStateUpdate={onStateUpdate} />)}
                {report !== null && (
                  <ReportBlock program={report} isStreaming={isStreaming} panelId={`${citationScope?.messageId ?? 'message'}:${partId ?? 'part'}`} citations={reportCitations} citationScope={citationScope} onParseResult={setReportParsed} />
                )}
                {trailing.length > 0 && <CitationsInline citations={trailing} citationScope={citationScope} />}
              </>
            )}
          </CardSourceProvider>
        </OpenUiCitationContext.Provider>
      </ThemeProvider>
    </div>
  );
}
