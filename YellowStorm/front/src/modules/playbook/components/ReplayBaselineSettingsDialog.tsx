import { useEffect, useImperativeHandle, useMemo, useState, forwardRef, useRef } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';
import type { PlaybookTask, ValidatedTaskReplay } from '../types';

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
}

const DEFAULT_REPLAY_CONFIG = {
  replayOutputFormat: false,
  replayToolTrace: false,
  replayReasoningChain: true,
};

export interface ReplayBaselineSettingsDialogHandle {
  flushSave: () => Promise<void>;
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
}: ReplayBaselineSettingsDialogProps,
ref,
) {
  const { t } = useModuleTranslation('playbook');
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const updateTaskReplayFormatGuide = usePlaybookStore((s) => s.updateTaskReplayFormatGuide);
  const renameTaskReplay = usePlaybookStore((s) => s.renameTaskReplay);
  const deleteTaskReplay = usePlaybookStore((s) => s.deleteTaskReplay);
  const [labelDraft, setLabelDraft] = useState('');
  const [replayConfigDraft, setReplayConfigDraft] = useState(DEFAULT_REPLAY_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const [replayLoadFailed, setReplayLoadFailed] = useState(false);
  const [replayMissing, setReplayMissing] = useState(false);
  const [currentReplay, setCurrentReplay] = useState<ValidatedTaskReplay | null>(replay ?? null);

  useEffect(() => {
    if (!open) return;
    setCurrentReplay(replay ?? null);
  }, [open, replay]);

  useEffect(() => {
    let cancelled = false;

    const loadReplay = async () => {
      if (!open || !replayId) return;
      setIsLoadingReplay(true);
      setReplayLoadFailed(false);
      setReplayMissing(false);
      try {
        const replays = await fetchTaskReplays(playbookId, task.id);
        if (cancelled) return;
        const matchedReplay = replays.find((item) => item.id === replayId) || null;
        setCurrentReplay(matchedReplay);
        setReplayMissing(!matchedReplay);
      } catch {
        if (cancelled) return;
        setCurrentReplay(null);
        setReplayLoadFailed(true);
        setReplayMissing(false);
      } finally {
        if (!cancelled) setIsLoadingReplay(false);
      }
    };

    void loadReplay();

    return () => {
      cancelled = true;
    };
  }, [open, fetchTaskReplays, playbookId, replayId, task.id]);

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
        outputFormatGuide: replayToSave.outputFormatGuide || '',
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
