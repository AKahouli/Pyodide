import './devtools-off';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { Renderer, type ActionEvent, type ParseResult } from '@openuidev/react-lang';
import { CardSourceProvider, ThemeProvider } from '@openuidev/react-ui';
import '@openuidev/react-ui/styles/index.css';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { CitationsInline, type CitationData } from '@/components/ai-elements/ai-message-content';
import { OpenUiCitationContext, splitCitations, toStockSources, type OpenUiCitationScope } from './citations';
import { openUiLibrary } from './library';
import { OPENUI_COMPACT_THEME } from './theme';

export interface OpenUiRendererProps {
  content: string;
  isStreaming: boolean;
  onAction: (event: ActionEvent) => void;
  citations?: CitationData[];
  citationScope?: OpenUiCitationScope;
  /** Shown instead of the program once the answer is complete and still has no renderable root. */
  fallback?: ReactNode;
  /** Tags the scope with the stored text component it renders (see plain-text.ts). */
  partId?: string;
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
export default function OpenUiRenderer({ content, isStreaming, onAction, citations, citationScope, fallback, partId }: Readonly<OpenUiRendererProps>) {
  const { theme } = useContext(ThemeProviderContext);
  const mode = resolveOpenUiMode(theme);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const { byReference, trailing } = useMemo(() => splitCitations(citations, content, citationScope), [citations, content, citationScope]);
  const stockSources = useMemo(() => toStockSources(byReference), [byReference]);
  const citationValue = useMemo(() => ({ byReference, scope: citationScope }), [byReference, citationScope]);
  // While streaming, partial or invalid text must never swap the view: only a
  // finished answer that never produced a root falls back to the markdown view.
  const unrenderable = !isStreaming && content.trim() !== '' && parsed !== null && parsed.root === null;
  return (
    <div {...{ [THEME_SCOPE_ATTRIBUTE]: '' }} data-openui-part={partId} data-testid='openui-answer' className='min-w-0'>
      <ThemeProvider mode={mode} lightTheme={OPENUI_COMPACT_THEME} darkTheme={OPENUI_COMPACT_THEME} cssSelector={`[${THEME_SCOPE_ATTRIBUTE}]`}>
        <OpenUiCitationContext.Provider value={citationValue}>
          <CardSourceProvider sources={stockSources}>
            {unrenderable && fallback ? fallback : (
              <>
                <Renderer response={content} library={openUiLibrary} isStreaming={isStreaming} onAction={onAction} onParseResult={setParsed} />
                {trailing.length > 0 && <CitationsInline citations={trailing} citationScope={citationScope} />}
              </>
            )}
          </CardSourceProvider>
        </OpenUiCitationContext.Provider>
      </ThemeProvider>
    </div>
  );
}
