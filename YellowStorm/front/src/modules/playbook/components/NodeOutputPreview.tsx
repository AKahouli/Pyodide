import { FileText } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { getPreferredStepResultText } from '../utils/step-result-display';
import { getArtifactPreviewContent } from '../utils/artifact-content';
import type { TaskResult } from '../types';
import { PlaybookArtifactActions } from './PlaybookArtifactActions';

export function NodeOutputPreview({ result, executionId, onDetails, compact = false }: {
  result?: TaskResult; executionId?: string; onDetails: () => void; compact?: boolean;
}) {
  const { t } = useModuleTranslation('playbook');
  if (!result || result.status !== 'completed') return null;
  const artifacts = result.artifacts ?? [];
  const text = getPreferredStepResultText(result) || artifacts.map((artifact) => getArtifactPreviewContent(artifact)).find(Boolean);
  if (!text && artifacts.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" onClick={(event) => event.stopPropagation()}
          className={cn(
            'nodrag nopan flex max-w-full items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
            compact && 'h-6 max-w-24 shrink-0 border-primary/20 bg-primary/5 px-1.5 text-primary shadow-sm',
          )}
          aria-label={t('nodeOutput.open')} title={t('nodeOutput.open')}>
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{compact ? t('nodeOutput.badge') : artifacts[0]?.filename || t('nodeOutput.ready')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={16} collisionPadding={12}
        className="nodrag nopan max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-24px)] overflow-auto space-y-3" onClick={(event) => event.stopPropagation()}>
        <div className="text-sm font-semibold">{t('nodeOutput.title')}</div>
        {text && <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{text.slice(0, 4000)}</div>}
        {artifacts.slice(0, 5).map((artifact, index) => <div key={artifact.artifactId || index} className="min-w-0 border-t pt-2">
          <div className="break-words text-xs font-medium">{artifact.filename || t('nodeOutput.ready')}</div>
          {executionId && artifact.artifactId && <PlaybookArtifactActions executionId={executionId}
            artifactId={artifact.artifactId} filename={artifact.filename || 'output'} mimeType={artifact.mimeType} />}
        </div>)}
        <button type="button" className="text-xs font-medium text-primary underline underline-offset-4" onClick={onDetails}>{t('nodeOutput.details')}</button>
      </PopoverContent>
    </Popover>
  );
}
