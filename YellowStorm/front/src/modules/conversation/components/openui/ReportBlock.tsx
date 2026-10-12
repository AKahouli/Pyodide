import './devtools-off';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createLibrary, Renderer, type DefinedComponent, type ParseResult } from '@openuidev/react-lang';
import { ChatProvider, DetailedViewContext, type ChatLLM } from '@openuidev/react-headless';
import { reportLibrary } from '@openuidev/thesys';
import { CitationsInline, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useModuleTranslation } from '@/modules/localization';
import { reportPanelStore } from './report-panel-store';
import type { OpenUiCitationScope } from './citations';

/**
 * Two reasons the thesys `Report` needs a provider: it is an artifact component (a chip in the chat
 * plus a panel, wired through the detailed-view store of react-headless), and its panel reads the chat
 * store. We have no chat store to offer, so a ChatProvider with an inert LLM satisfies the second,
 * and our own panel store (report-panel-store.ts) replaces the provider's detailed-view store.
 */
const INERT_LLM: ChatLLM = {
  send: () => Promise.reject(new Error('OpenUI reports do not send messages')),
  streamProtocol: { parse: () => (async function* () { /* no events */ })() },
};

/** Which answer the report belongs to: two answers' reports are both `root`, and the panel is keyed by statement. */
const ReportScopeContext = createContext('');

type StockComponent = (args: { props: unknown; renderNode: (node: unknown) => ReactNode; statementId?: string }) => ReactNode;

/** Same component, with the statement id prefixed by the answer so two reports never share a panel. */
function scoped(Stock: StockComponent): StockComponent {
  return function ScopedReport(args) {
    const scope = useContext(ReportScopeContext);
    return <Stock {...args} statementId={`${scope}:${args.statementId ?? 'root'}`} />;
  } as StockComponent;
}

const openUiReportLibrary = createLibrary({
  root: reportLibrary.root,
  componentGroups: reportLibrary.componentGroups,
  components: Object.values(reportLibrary.components).map((definition) => (definition.name === 'Report'
    ? ({ ...definition, component: scoped(definition.component as StockComponent) } as DefinedComponent)
    : definition)),
});

interface ReportBlockProps {
  program: string;
  isStreaming: boolean;
  /** Stable id of the answer part; keys the panel. */
  panelId: string;
  /** Citations the report text marks (the report text cannot render chips, so they are listed under it). */
  citations: CitationData[];
  citationScope?: OpenUiCitationScope;
  onParseResult?: (result: ParseResult | null) => void;
}

/**
 * The report of an OpenUI answer: the thesys chip inline, whose View button opens the full report in
 * the conversation's report panel (ReportPanelSidebar). The report text is rendered by editable
 * rich-text blocks that cannot carry our citation chips, so the sources it marks are listed under the chip.
 */
export function ReportBlock({ program, isStreaming, panelId, citations, citationScope, onParseResult }: Readonly<ReportBlockProps>) {
  const { t } = useModuleTranslation('conversation');
  // The panel portals the report out of this block's tree: if the block goes away (message unmounted by a
  // reload or list virtualization) while its report is open, the panel would be left empty, so close it.
  useEffect(() => () => {
    const { activeDetailedViewId, reset } = reportPanelStore.getState();
    if (activeDetailedViewId?.startsWith(`${panelId}:`)) reset();
  }, [panelId]);
  return (
    <div data-openui-report='' data-testid='openui-report'>
      <ChatProvider llm={INERT_LLM}>
        <DetailedViewContext.Provider value={reportPanelStore}>
          <ReportScopeContext.Provider value={panelId}>
            <Renderer response={program} library={openUiReportLibrary} isStreaming={isStreaming} onParseResult={onParseResult} />
          </ReportScopeContext.Provider>
        </DetailedViewContext.Provider>
      </ChatProvider>
      {citations.length > 0 && (
        <div className='mt-1 text-xs text-muted-foreground'>
          {t('openui.report.sources')}
          <CitationsInline citations={citations} citationScope={citationScope} />
        </div>
      )}
    </div>
  );
}
