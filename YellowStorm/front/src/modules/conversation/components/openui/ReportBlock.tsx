import './devtools-off';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { createLibrary, Renderer, type DefinedComponent, type ParseResult } from '@openuidev/react-lang';
import { ChatProvider, DetailedViewContext, type ChatLLM } from '@openuidev/react-headless';
import { reportLibrary, presentationLibrary } from '@openuidev/thesys';
import { CitationsInline, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useModuleTranslation } from '@/modules/localization';
import { reportPanelStore } from './report-panel-store';
import type { OpenUiCitationScope } from './citations';
import { SlideExportMenu } from './SlideExportMenu';
import { loadGeneratedImage } from './document-images';

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

const openUiPresentationLibrary = createLibrary({
  root: presentationLibrary.root,
  componentGroups: presentationLibrary.componentGroups,
  components: Object.values(presentationLibrary.components).map((definition) => (definition.name === 'Presentation'
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
 * A report or presentation of an OpenUI answer: the stock chip's View button opens the artifact in
 * the conversation's report panel (ReportPanelSidebar). The report text is rendered by editable
 * rich-text blocks that cannot carry our citation chips, so the sources it marks are listed under the chip.
 */
export function ReportBlock({ program, isStreaming, panelId, citations, citationScope, onParseResult }: Readonly<ReportBlockProps>) {
  const { t } = useModuleTranslation('conversation');
  const presentation = /^\s*root\s*=\s*Presentation\s*\(/.test(program);
  const library = presentation ? openUiPresentationLibrary : openUiReportLibrary;
  const activeId = useStore(reportPanelStore, (state) => state.activeDetailedViewId);
  const exportMenuNode = useStore(reportPanelStore, (state) => state._exportMenuNode);
  const generatedSources = [...new Set([...program.matchAll(/"generated-image:[a-f\d]{24}"/g)].map((match) => JSON.parse(match[0]) as string))];
  const imageKey = JSON.stringify([program, citationScope]);
  const [resolved, setResolved] = useState<{ key: string; program: string; failed?: boolean }>({ key: '', program: '' });
  useEffect(() => {
    if (!generatedSources.length || isStreaming) return;
    const controller = new AbortController();
    const urls: string[] = [];
    void (async () => {
      if (!citationScope) throw new Error('Missing image scope');
      let response = program;
      for (const source of generatedSources) {
        const blob = await loadGeneratedImage(source, citationScope, controller.signal);
        controller.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        urls.push(url);
        response = response.replaceAll(JSON.stringify(source), JSON.stringify(url));
      }
      setResolved({ key: imageKey, program: response });
    })().catch(() => { if (!controller.signal.aborted) setResolved({ key: imageKey, program: '', failed: true }); });
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [imageKey, isStreaming]);
  const needsImages = generatedSources.length > 0;
  const imageReady = !needsImages || (!isStreaming && resolved.key === imageKey && !resolved.failed);
  // The panel portals the report out of this block's tree: if the block goes away (message unmounted by a
  // reload or list virtualization) while its report is open, the panel would be left empty, so close it.
  useEffect(() => () => {
    const { activeDetailedViewId, reset } = reportPanelStore.getState();
    if (activeDetailedViewId?.startsWith(`artifact-${panelId}:`) || activeDetailedViewId?.startsWith(`${panelId}:`)) reset();
  }, [panelId]);
  return (
    <div data-openui-report='' data-testid='openui-report'>
      {presentation && activeId === `artifact-${panelId}:root` && exportMenuNode && createPortal(<SlideExportMenu program={program} isStreaming={isStreaming} citationScope={citationScope} />, exportMenuNode)}
      <ChatProvider llm={INERT_LLM}>
        <DetailedViewContext.Provider value={reportPanelStore}>
          <ReportScopeContext.Provider value={panelId}>
            {imageReady ? <Renderer response={needsImages ? resolved.program : program} library={library} isStreaming={isStreaming} onParseResult={onParseResult} />
              : <div role={resolved.key === imageKey && resolved.failed ? 'alert' : 'status'} className='rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground'>{t(resolved.key === imageKey && resolved.failed ? 'openui.image.unavailable' : 'openui.image.loading')}</div>}
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
