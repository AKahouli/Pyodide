import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';

export type StepReplayMode = 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';

export type ReferenceModePromptState = {
  taskId: string;
  taskTitle: string;
} | null;

type ReferenceModePromptDialogProps = Readonly<{
  prompt: ReferenceModePromptState;
  onClose: () => void;
  onChooseMode: (mode: StepReplayMode) => void;
}>;

export function ReferenceModePromptDialog({ prompt, onClose, onChooseMode }: ReferenceModePromptDialogProps) {
  const { t } = useModuleTranslation('playbook');

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('referenceModePrompt.title')}</DialogTitle>
          <DialogDescription>
            {t('referenceModePrompt.description', { task: prompt?.taskTitle ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div className="font-medium text-amber-900 dark:text-amber-100">{t('referenceModePrompt.infoTitle')}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['live', 'replay_strict', 'replay_flex', 'replay_adaptive'] as StepReplayMode[]).map((mode) => (
              <div key={mode} className="rounded-md border bg-background/80 p-3">
                <div className="font-medium">{t(`referenceModePrompt.mode.${mode}.title`)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t(`referenceModePrompt.mode.${mode}.description`)}</div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-wrap sm:justify-start sm:space-x-0">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={() => onChooseMode('live')}>
            {t('referenceModePrompt.action.live')}
          </Button>
          <Button onClick={() => onChooseMode('replay_strict')}>
            {t('referenceModePrompt.action.replayStrict')}
          </Button>
          <Button onClick={() => onChooseMode('replay_flex')}>
            {t('referenceModePrompt.action.replayFlex')}
          </Button>
          <Button onClick={() => onChooseMode('replay_adaptive')}>
            {t('referenceModePrompt.action.replayAdaptive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
