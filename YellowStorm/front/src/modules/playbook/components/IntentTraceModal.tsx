import { useCallback, useEffect, useState } from 'react';
import { Clipboard, ClipboardCheck, Loader2, ScrollText } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import type { PlaybookIntentTraceEntry, PlaybookIntentTraceStage } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intentAnalyze: PlaybookIntentTraceEntry[];
  designAssessment: PlaybookIntentTraceEntry[];
  loading?: boolean;
}

type Pane = 'intent-analyze' | 'design-assessment';

interface PaneConfig {
  id: Pane;
  trace: PlaybookIntentTraceEntry[];
}

const EMPTY_ENTRY: Pick<PlaybookIntentTraceEntry, 'stage' | 'model' | 'systemPrompt' | 'userPrompt' | 'rawOutput' | 'createdAt'> = {
  stage: 'intent.analyze',
  model: '',
  systemPrompt: '',
  userPrompt: '',
  rawOutput: '',
  createdAt: '',
};

export function IntentTraceModal({ open, onOpenChange, intentAnalyze, designAssessment, loading }: Props) {
  const { t } = useModuleTranslation('playbook');

  const panes: PaneConfig[] = [
    { id: 'intent-analyze', trace: intentAnalyze },
    { id: 'design-assessment', trace: designAssessment },
  ];
  const firstNonEmpty = panes.find((pane) => pane.trace.length > 0)?.id ?? 'intent-analyze';
  const [activePane, setActivePane] = useState<Pane>(firstNonEmpty);
  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');
  const [copiedPaneTab, setCopiedPaneTab] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setActivePane(firstNonEmpty);
      setActiveTab('input');
      setCopiedPaneTab(null);
    }
  }, [open, firstNonEmpty]);

  const handleCopy = useCallback(async (paneId: Pane, tab: 'input' | 'output', text: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      const key = `${paneId}-${tab}`;
      setCopiedPaneTab(key);
      showSuccess(t('designer.traces.copied'));
      window.setTimeout(() => {
        setCopiedPaneTab((current) => (current === key ? null : current));
      }, 1500);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('designer.traces.copyFailed'));
    }
  }, [t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-[min(96vw,1280px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            {t('designer.traces.title')}
          </DialogTitle>
          <DialogDescription>{t('designer.traces.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {panes.map((pane) => {
            const stage: PlaybookIntentTraceStage = pane.id === 'intent-analyze' ? 'intent.analyze' : 'intent.design_assessment';
            const entry = pane.trace[pane.trace.length - 1] ?? null;
            return (
              <PaneColumn
                key={pane.id}
                paneId={pane.id}
                stage={stage}
                title={pane.id === 'intent-analyze' ? t('designer.traces.pane.intentAnalyze') : t('designer.traces.pane.designAssessment')}
                count={pane.trace.length}
                entry={entry}
                active={activePane === pane.id}
                onActivate={() => setActivePane(pane.id)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                copiedKey={copiedPaneTab}
                onCopy={(tab, text) => void handleCopy(pane.id, tab, text)}
                emptyLabel={t('designer.traces.empty')}
                loading={Boolean(loading) && !entry}
                inputLabel={t('designer.traces.input')}
                outputLabel={t('designer.traces.output')}
                modelLabel={t('designer.traces.model')}
                copyLabel={t('designer.traces.copy')}
                copiedLabel={t('designer.traces.copied')}
                copyButtonLabel={t('designer.traces.copyButton')}
              />
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PaneColumnProps {
  paneId: Pane;
  stage: PlaybookIntentTraceStage;
  title: string;
  count: number;
  entry: PlaybookIntentTraceEntry | null;
  active: boolean;
  onActivate: () => void;
  activeTab: 'input' | 'output';
  onTabChange: (tab: 'input' | 'output') => void;
  copiedKey: string | null;
  onCopy: (tab: 'input' | 'output', text: string) => void;
  emptyLabel: string;
  loading: boolean;
  inputLabel: string;
  outputLabel: string;
  modelLabel: string;
  copyLabel: string;
  copiedLabel: string;
  copyButtonLabel: string;
}

function PaneColumn({
  paneId,
  title,
  count,
  entry,
  active,
  onActivate,
  activeTab,
  onTabChange,
  copiedKey,
  onCopy,
  emptyLabel,
  loading,
  inputLabel,
  outputLabel,
  modelLabel,
  copyLabel,
  copyButtonLabel,
}: PaneColumnProps) {
  const visibleEntry = entry ?? { ...EMPTY_ENTRY };
  const inputText = `${visibleEntry.systemPrompt}\n\n--- USER ---\n${visibleEntry.userPrompt}`.trim();
  const outputText = visibleEntry.rawOutput;
  const currentCopyKey = `${paneId}-${activeTab}`;
  const isCopied = copiedKey === currentCopyKey;
  const activeCopyText = activeTab === 'input' ? inputText : outputText;

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col border-border/60 md:border-l md:first:border-l-0',
        active && 'bg-background',
      )}
    >
      <header
        className="flex shrink-0 cursor-pointer items-center justify-between gap-2 border-b px-4 py-3"
        onClick={onActivate}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          <Badge variant="outline" className="h-5 px-2 text-[10px]">
            {count}
          </Badge>
        </div>
      </header>
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as 'input' | 'output')}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
          <TabsList className="h-8">
            <TabsTrigger value="input" className="h-6 px-3 text-xs">
              {inputLabel}
            </TabsTrigger>
            <TabsTrigger value="output" className="h-6 px-3 text-xs">
              {outputLabel}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {visibleEntry.model && (
              <Badge variant="secondary" className="h-5 px-2 text-[10px] font-normal">
                {modelLabel}: <span className="ml-1 font-mono">{visibleEntry.model}</span>
              </Badge>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => onCopy(activeTab, activeCopyText)}
              disabled={!activeCopyText || loading}
              aria-label={copyButtonLabel}
              title={copyButtonLabel}
            >
              {isCopied ? <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> : <Clipboard className="mr-1 h-3.5 w-3.5" />}
              {isCopied ? copyLabel : copyButtonLabel}
            </Button>
          </div>
        </div>
        <TabsContent value="input" className="m-0 min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin opacity-60" />} label={emptyLabel} />
          ) : entry ? (
            <ScrollablePre content={inputText} />
          ) : (
            <EmptyState icon={<Clipboard className="h-5 w-5 opacity-40" />} label={emptyLabel} />
          )}
        </TabsContent>
        <TabsContent value="output" className="m-0 min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin opacity-60" />} label={emptyLabel} />
          ) : entry ? (
            <ScrollablePre content={outputText} />
          ) : (
            <EmptyState icon={<Clipboard className="h-5 w-5 opacity-40" />} label={emptyLabel} />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function ScrollablePre({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto bg-muted/20 p-4">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{content || '-'}</pre>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
  );
}