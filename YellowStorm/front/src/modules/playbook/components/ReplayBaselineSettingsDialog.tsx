import { useEffect, useImperativeHandle, useMemo, useState, forwardRef, useRef, type ReactNode } from 'react';
import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';
import type { PlaybookTask, ValidatedTaskReplay } from '../types';
import { ReplayTemplateSummary } from './ReplayTemplateSummary';

interface ReplayBaselineSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookId: string;
  task: PlaybookTask;
  replayId?: string | null;
  replay?: ValidatedTaskReplay | null;
  onOpenOutputFormatEditor?: (taskId: string) => Promise<void> | void;
  onReplayUpdated?: (replay: ValidatedTaskReplay) => void;
  onReplayRemoved?: (replayId: string) => void;
  defaultTab?: 'capture' | 'settings';
}

const DEFAULT_REPLAY_CONFIG = {
  replayOutputFormat: true,
  replayToolTrace: true,
  replayReasoningChain: true,
};

export interface ReplayBaselineSettingsDialogHandle {
  flushSave: () => Promise<void>;
}

function formatStructuredValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function summarizeReplayMode(mode: ValidatedTaskReplay['mode']): 'strict' | 'flex' | 'adaptive' {
  if (mode === 'replay_flex') return 'flex';
  if (mode === 'replay_adaptive') return 'adaptive';
  return 'strict';
}

function countFingerprintKeys(replay: ValidatedTaskReplay | null): number {
  if (!replay?.fingerprints) return 0;
  return Object.values(replay.fingerprints).filter(Boolean).length;
}

export const ReplayBaselineSettingsDialog = forwardRef<ReplayBaselineSettingsDialogHandle, ReplayBaselineSettingsDialogProps>(function ReplayBaselineSettingsDialog({
  open,
  onOpenChange,
  playbookId,
  task,
  replayId,
  replay,
  onOpenOutputFormatEditor,
  onReplayUpdated,
  onReplayRemoved,
  defaultTab = 'settings',
}: ReplayBaselineSettingsDialogProps,
ref,
) {
  const { t, language } = useModuleTranslation('playbook');
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const updateTaskReplayFormatGuide = usePlaybookStore((s) => s.updateTaskReplayFormatGuide);
  const renameTaskReplay = usePlaybookStore((s) => s.renameTaskReplay);
  const deleteTaskReplay = usePlaybookStore((s) => s.deleteTaskReplay);
  const [labelDraft, setLabelDraft] = useState(() => replay?.label || '');
  const [replayConfigDraft, setReplayConfigDraft] = useState(DEFAULT_REPLAY_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const [replayLoadFailed, setReplayLoadFailed] = useState(false);
  const [replayMissing, setReplayMissing] = useState(false);
  const [currentReplay, setCurrentReplay] = useState<ValidatedTaskReplay | null>(null);
  const [activeTab, setActiveTab] = useState<'capture' | 'settings'>(defaultTab);

  useEffect(() => {
    if (!open) return;
    setActiveTab(defaultTab);
  }, [defaultTab, open]);

  useEffect(() => {
    let cancelled = false;

    const loadReplay = async () => {
      if (!open) return;
      setIsLoadingReplay(true);
      setReplayLoadFailed(false);
      setReplayMissing(false);

      if (replayId) {
        try {
          const replays = await fetchTaskReplays(playbookId, task.id);
          if (cancelled) return;
          const matchedReplay = replays.find((item) => item.id === replayId) || null;
          setCurrentReplay(matchedReplay);
          setLabelDraft(matchedReplay?.label || '');
          setReplayMissing(!matchedReplay);
        } catch {
          if (cancelled) return;
          setCurrentReplay(null);
          setReplayLoadFailed(true);
          setReplayMissing(false);
        }
      } else {
        setCurrentReplay(replay ?? null);
        setLabelDraft(replay?.label || '');
      }

      if (!cancelled) setIsLoadingReplay(false);
    };

    void loadReplay();

    return () => {
      cancelled = true;
    };
  }, [open, replayId, fetchTaskReplays, playbookId, task.id, replay]);

  useEffect(() => {
    if (!open || !currentReplay) return;
    setLabelDraft(currentReplay.label || '');
    setReplayConfigDraft({
      replayOutputFormat: currentReplay.replayConfig?.replayOutputFormat ?? false,
      replayToolTrace: currentReplay.replayConfig?.replayToolTrace ?? false,
      replayReasoningChain: currentReplay.replayConfig?.replayReasoningChain ?? true,
    });
  }, [open, currentReplay]);

  const activeReplayId = replayId || currentReplay?.id || null;
  const isBusy = isSaving || isRemoving || isLoadingReplay;
  const canEditReplay = Boolean(currentReplay && !replayLoadFailed);
  const dialogDescription = useMemo(() => {
    if (currentReplay?.validationVersion) {
      return t('baselineBadge.dialogDescriptionVersioned', { version: currentReplay.validationVersion });
    }
    return t('baselineBadge.dialogDescription');
  }, [currentReplay?.validationVersion, t]);
  const captureSummaryItems = useMemo(() => {
    if (!currentReplay) return [];
    return [
      { label: t('baselineBadge.summary.execution'), value: `#${currentReplay.referenceExecutionNumber}` },
      { label: t('baselineBadge.summary.mode'), value: t(`baselineBadge.mode.${summarizeReplayMode(currentReplay.mode)}` as any) },
      { label: t('baselineBadge.summary.toolCalls'), value: String(currentReplay.toolTraceTemplate?.length ?? currentReplay.toolCalls.length) },
      { label: t('baselineBadge.summary.contextVariables'), value: String(currentReplay.contextVariableSchema?.length ?? 0) },
      { label: t('baselineBadge.summary.reasoning'), value: String(currentReplay.reasoningOutline?.length ?? currentReplay.reasoningChain?.length ?? 0) },
      { label: t('baselineBadge.summary.fingerprints'), value: String(countFingerprintKeys(currentReplay)) },
    ];
  }, [currentReplay, t]);

  const performSave = async () => {
    if (!activeReplayId || !canEditReplay) return false;
    const replayToSave = currentReplay;
    if (!replayToSave) return false;
    setIsSaving(true);
    try {
      let updatedReplay = replayToSave;
      const trimmedLabel = labelDraft.trim();
      const nextLabel = trimmedLabel || null;

      if ((replayToSave.label || null) !== nextLabel) {
        updatedReplay = await renameTaskReplay(playbookId, task.id, activeReplayId, nextLabel);
      }

      updatedReplay = await updateTaskReplayFormatGuide(playbookId, task.id, activeReplayId, {
        outputFormatGuide: replayToSave.outputFormatGuide ?? undefined,
        replayConfig: replayConfigDraft,
      });

      setCurrentReplay(updatedReplay);
      onReplayUpdated?.(updatedReplay);
      return true;
    } finally {
      setIsSaving(false);
    }
  };

  const performSaveRef = useRef(performSave);
  performSaveRef.current = performSave;

  useImperativeHandle(ref, () => ({
    flushSave: async () => {
      if (canEditReplay && currentReplay) {
        await performSaveRef.current();
      }
    },
  }), [canEditReplay, currentReplay]);

  const handleSave = () => void performSave().then(() => onOpenChange(false));

  const handleOpenOutputFormatEditor = async () => {
    if (!onOpenOutputFormatEditor || !canEditReplay || !currentReplay) return;
    await performSave();
    await onOpenOutputFormatEditor(task.id);
  };

  const handleRemove = async () => {
    if (!activeReplayId || !canEditReplay) return;
    setIsRemoving(true);
    try {
      await deleteTaskReplay(playbookId, task.id, activeReplayId);
      onReplayRemoved?.(activeReplayId);
      onOpenChange(false);
    } finally {
      setIsRemoving(false);
    }
  };

  const renderCaptureSection = (
    key: string,
    title: string,
    emptyLabel: string,
    content: ReactNode,
    hasContent: boolean,
  ) => (
    <Collapsible key={key} defaultOpen={false} className="rounded-lg border bg-background p-4">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 text-left">
        <span className="font-medium">{title}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        {hasContent ? content : <div className="text-sm text-muted-foreground">{emptyLabel}</div>}
      </CollapsibleContent>
    </Collapsible>
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && canEditReplay && currentReplay) {
        void performSave().then(() => onOpenChange(false));
        return;
      }
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('baselineBadge.dialogTitle')}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {isLoadingReplay ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('baselineBadge.loading')}
          </div>
        ) : !currentReplay ? (
          <div className="rounded-md border border-muted bg-muted/30 p-3 text-sm text-muted-foreground">
            {replayLoadFailed ? t('baselineBadge.replayLoadFailed') : t('baselineBadge.missingReplay')}
          </div>
        ) : (
          <ScrollArea className="max-h-[70vh] pr-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'capture' | 'settings')} className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="capture">{t('baselineBadge.tabs.capture')}</TabsTrigger>
                <TabsTrigger value="settings">{t('baselineBadge.tabs.settings')}</TabsTrigger>
              </TabsList>

              <TabsContent value="capture" className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{t('baselineBadge.captureTitle')}</div>
                    <Badge variant="outline">{t('baselineBadge.validationVersion', { version: currentReplay.validationVersion })}</Badge>
                    {currentReplay.isStale && <Badge variant="secondary">{t('detail.badges.stale')}</Badge>}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {captureSummaryItems.map((item) => (
                      <div key={item.label} className="rounded-md border bg-background p-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</div>
                        <div className="mt-1 text-sm font-medium">{item.value}</div>
                      </div>
                    ))}
                  </div>
                  {(currentReplay.isStale || currentReplay.staleReasons?.length) && (
                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <div className="font-medium text-foreground">{t('baselineBadge.staleTitle')}</div>
                      {(currentReplay.staleReasons && currentReplay.staleReasons.length > 0)
                        ? currentReplay.staleReasons.map((reason) => <div key={reason}>{reason}</div>)
                        : <div>{t('baselineBadge.staleEmpty')}</div>}
                    </div>
                  )}
                </div>

                {renderCaptureSection(
                  'replay-template',
                  t('baselineBadge.sections.replayTemplate'),
                  t('baselineBadge.empty.replayTemplate'),
                  <ReplayTemplateSummary replay={currentReplay} />,
                  Boolean(
                    currentReplay.intentKey
                    || currentReplay.intentLabel
                    || (currentReplay.reasoningOutline?.length ?? 0) > 0
                    || (currentReplay.stableReasoningRules?.length ?? 0) > 0
                    || (currentReplay.contextVariableSchema?.length ?? 0) > 0
                    || (currentReplay.toolTraceTemplate?.length ?? 0) > 0
                    || currentReplay.outputContract
                    || currentReplay.driftPolicy
                    || (currentReplay.acceptedExamples?.length ?? 0) > 0,
                  ),
                )}

                {renderCaptureSection(
                  'metadata',
                  t('baselineBadge.sections.metadata'),
                  t('baselineBadge.empty.metadata'),
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.createdAt')}</div>
                      <div className="mt-1">{formatDateTime(currentReplay.createdAt, language)}</div>
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.updatedAt')}</div>
                      <div className="mt-1">{formatDateTime(currentReplay.updatedAt, language)}</div>
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.referenceExecution')}</div>
                      <div className="mt-1">#{currentReplay.referenceExecutionNumber}</div>
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.agent')}</div>
                      <div className="mt-1">{currentReplay.agentName || currentReplay.referenceAssignedAgentId || '-'}</div>
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm sm:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.taskDescription')}</div>
                      <div className="mt-1 whitespace-pre-wrap">{currentReplay.referenceTaskDescription || '-'}</div>
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.model')}</div>
                      <div className="mt-1">{currentReplay.referenceUsage?.model || '-'}</div>
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.fields.tokens')}</div>
                      <div className="mt-1">{currentReplay.referenceUsage?.totalTokens ?? '-'}</div>
                    </div>
                  </div>,
                  true,
                )}

                {renderCaptureSection(
                  'output',
                  t('baselineBadge.sections.output'),
                  t('baselineBadge.empty.output'),
                  <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">{currentReplay.referenceOutput}</pre>,
                  Boolean(currentReplay.referenceOutput),
                )}

                {renderCaptureSection(
                  'output-format',
                  t('baselineBadge.sections.outputFormat'),
                  t('baselineBadge.empty.outputFormat'),
                  <Textarea
                    value={currentReplay.outputFormatGuide || ''}
                    readOnly
                    rows={12}
                    className="resize-none bg-muted/30 text-xs"
                    placeholder={t('outputFormatDialog.placeholder')}
                  />,
                  Boolean(currentReplay.outputFormatGuide),
                )}

                {renderCaptureSection(
                  'tool-calls',
                  t('baselineBadge.sections.toolCalls'),
                  t('baselineBadge.empty.toolCalls'),
                  <div className="space-y-3">
                    {currentReplay.toolCalls.map((item) => (
                      <div key={`baseline-tool-${item.callIndex}-${item.toolName}`} className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{item.callIndex}.</span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.toolName}</code>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.toolTrace.args')}</div>
                            <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(item.args)}</pre>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.toolTrace.outputSummary')}</div>
                            <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">{item.outputSummary || '-'}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>,
                  currentReplay.toolCalls.length > 0,
                )}

                {renderCaptureSection(
                  'reasoning',
                  t('baselineBadge.sections.reasoning'),
                  t('baselineBadge.empty.reasoning'),
                  <div className="space-y-3">
                    {(currentReplay.reasoningChain ?? []).map((item) => (
                      <div key={item.id} className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.label}</span>
                          <Badge variant="outline">{item.type}</Badge>
                          {item.confidence != null && <Badge variant="secondary">{t('baselineBadge.reasoningConfidence', { value: item.confidence })}</Badge>}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    ))}
                  </div>,
                  (currentReplay.reasoningChain?.length ?? 0) > 0,
                )}

                {renderCaptureSection(
                  'prompts',
                  t('baselineBadge.sections.prompts'),
                  t('baselineBadge.empty.prompts'),
                  <div className="space-y-3">
                    {(currentReplay.llmPromptTrace ?? []).map((item, index) => (
                      <div key={`baseline-prompt-${item.stage}-${index}`} className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{item.stage}</Badge>
                          <code className="rounded bg-background px-1.5 py-0.5 text-xs">{item.model || '-'}</code>
                        </div>
                        <pre className="mt-3 max-h-[28rem] overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">{item.prompt}</pre>
                      </div>
                    ))}
                  </div>,
                  (currentReplay.llmPromptTrace?.length ?? 0) > 0,
                )}

                {renderCaptureSection(
                  'node-snapshot',
                  t('baselineBadge.sections.nodeSnapshot'),
                  t('baselineBadge.empty.nodeSnapshot'),
                  <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(currentReplay.referenceNodeSnapshot)}</pre>,
                  Boolean(currentReplay.referenceNodeSnapshot),
                )}

                {renderCaptureSection(
                  'fingerprints',
                  t('baselineBadge.sections.fingerprints'),
                  t('baselineBadge.empty.fingerprints'),
                  <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(currentReplay.fingerprints)}</pre>,
                  Boolean(currentReplay.fingerprints && countFingerprintKeys(currentReplay) > 0),
                )}

                {renderCaptureSection(
                  'trace-metadata',
                  t('baselineBadge.sections.traceMetadata'),
                  t('baselineBadge.empty.traceMetadata'),
                  <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(currentReplay.traceMetadata)}</pre>,
                  Boolean(currentReplay.traceMetadata && Object.keys(currentReplay.traceMetadata).length > 0),
                )}
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <div className="space-y-4">
              {replayLoadFailed && (
                <div className="rounded-md border border-muted bg-muted/30 p-3 text-sm text-muted-foreground">
                  {t('baselineBadge.replayLoadFailed')}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="replay-baseline-name">{t('baselineBadge.nameLabel')}</Label>
                <Input
                  id="replay-baseline-name"
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  placeholder={t('baselineBadge.renamePlaceholder')}
                  maxLength={100}
                  disabled={isBusy || !canEditReplay}
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">{t('nodeEditor.replayConfigSectionTitle')}</div>
                <div className="flex items-center justify-between rounded-md border p-3 gap-4">
                  <div>
                    <div className="text-sm font-medium">{t('nodeEditor.replayConfigOutputFormat')}</div>
                    <div className="text-xs text-muted-foreground">{t('nodeEditor.replayConfigOutputFormatHint')}</div>
                    {replayConfigDraft.replayOutputFormat && onOpenOutputFormatEditor && (
                      <div className="mt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-0"
                          onClick={() => void handleOpenOutputFormatEditor()}
                          disabled={isBusy || !canEditReplay}
                        >
                          {t('baselineBadge.editOutputFormatTemplate')}
                        </Button>
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={replayConfigDraft.replayOutputFormat}
                    onCheckedChange={(value) => setReplayConfigDraft((prev) => ({ ...prev, replayOutputFormat: value }))}
                    disabled={isBusy || !canEditReplay}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3 gap-4">
                  <div>
                    <div className="text-sm font-medium">{t('nodeEditor.replayConfigToolTrace')}</div>
                    <div className="text-xs text-muted-foreground">{t('nodeEditor.replayConfigToolTraceHint')}</div>
                  </div>
                  <Switch
                    checked={replayConfigDraft.replayToolTrace}
                    onCheckedChange={(value) => setReplayConfigDraft((prev) => ({ ...prev, replayToolTrace: value }))}
                    disabled={isBusy || !canEditReplay}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3 gap-4">
                  <div>
                    <div className="text-sm font-medium">{t('nodeEditor.replayConfigReasoningChain')}</div>
                    <div className="text-xs text-muted-foreground">{t('nodeEditor.replayConfigReasoningChainHint')}</div>
                  </div>
                  <Switch
                    checked={replayConfigDraft.replayReasoningChain}
                    onCheckedChange={(value) => setReplayConfigDraft((prev) => ({ ...prev, replayReasoningChain: value }))}
                    disabled={isBusy || !canEditReplay}
                  />
                </div>
              </div>

              {currentReplay.referenceOutput && (
                <div className="space-y-2">
                  <Label>{t('nodeEditor.formatGuideReference')}</Label>
                  <div className="max-h-52 overflow-auto rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap">
                    {currentReplay.referenceOutput}
                  </div>
                </div>
              )}
                </div>
              </TabsContent>
            </Tabs>
          </ScrollArea>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleRemove()}
            disabled={isBusy || !activeReplayId || !canEditReplay}
          >
            {isRemoving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {t('baselineBadge.remove')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={isBusy || !activeReplayId || !canEditReplay}>
              {isSaving ? `${t('common.save')}...` : t('baselineBadge.saveSettings')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
