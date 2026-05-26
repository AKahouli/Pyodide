import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { PORT_COLORS } from '../utils/port-colors';
import type { ArtifactKind } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePortName: string;
  sourceArtifactKind: ArtifactKind;
  targetPortName: string;
  targetArtifactKind: ArtifactKind;
  canModifyPorts: boolean;
  onCreateCompatibleInput: () => void;
  onUpdateExistingInput: () => void;
}

export function ArtifactKindMismatchDialog({
  open,
  onOpenChange,
  sourcePortName,
  sourceArtifactKind,
  targetPortName,
  targetArtifactKind,
  canModifyPorts,
  onCreateCompatibleInput,
  onUpdateExistingInput,
}: Props) {
  const { t } = useModuleTranslation('playbook');

  const sourceLabel = t(`artifactKind.${sourceArtifactKind}`);
  const targetLabel = t(`artifactKind.${targetArtifactKind}`);
  const sourceColor = PORT_COLORS[sourceArtifactKind];
  const targetColor = PORT_COLORS[targetArtifactKind];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('ports.mismatchDialog.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>{t('ports.mismatchDialog.description', { sourceKind: sourceLabel, targetKind: targetLabel })}</p>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-muted-foreground">{t('ports.mismatchDialog.source')}</span>
                  {sourceColor && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${sourceColor.raw}18`, color: sourceColor.raw }}>
                      <sourceColor.icon className="h-3 w-3" />
                      {sourcePortName}
                    </span>
                  )}
                  {!sourceColor && <span className="text-xs font-medium">{sourcePortName}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{t('ports.mismatchDialog.target')}</span>
                  {targetColor && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${targetColor.raw}18`, color: targetColor.raw }}>
                      <targetColor.icon className="h-3 w-3" />
                      {targetPortName}
                    </span>
                  )}
                  {!targetColor && <span className="text-xs font-medium">{targetPortName}</span>}
                </div>
              </div>
              {!canModifyPorts && (
                <p className="text-amber-600 dark:text-amber-400 text-xs">{t('ports.mismatchDialog.cannotModify')}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel>{t('ports.mismatchDialog.cancel')}</AlertDialogCancel>
          {canModifyPorts && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onUpdateExistingInput}>
                {t('ports.mismatchDialog.updateInput')}
              </Button>
              <Button type="button" size="sm" onClick={onCreateCompatibleInput}>
                {t('ports.mismatchDialog.createInput')}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
