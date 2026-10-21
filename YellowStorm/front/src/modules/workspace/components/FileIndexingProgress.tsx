import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { IndexingProgress, IndexingStatus } from '../types';

/**
 * The server owns the schedule and final result, including failure on the last step.
 * `align` places the summary line: the schedule sits under the file name in the file
 * list, and beside the status when the row itself is right-aligned.
 */
export function FileIndexingProgress({ progress, status, error, align = 'end' }: { progress?: IndexingProgress | null; status?: IndexingStatus; error?: string; align?: 'start' | 'end' }) {
  const { t } = useModuleTranslation('workspace');
  // A legacy terminal update can end a workflow without a fresh detailed step.
  if (!progress || (status === 'failed' && progress.processingStatus !== 'FAIL') || (status === 'ready' && progress.processingStatus !== 'FINISH')) {
    return <p role='status' title={error} className={cn('max-w-40 truncate text-xs text-muted-foreground sm:max-w-64', status === 'failed' && 'text-destructive')}>{error || t(`indexing.${status ?? 'none'}`)}</p>;
  }
  const failed = progress.processingStatus === 'FAIL' || progress.stepStatus === 'FAIL';
  const stepStatus = (number: number) => {
    if (number < progress.currentStep) return 'completed';
    if (number > progress.currentStep || progress.currentStep === 0) return 'pending';
    if (failed) return 'failed';
    if (progress.stepStatus === 'FINISH' || progress.processingStatus === 'FINISH') return 'completed';
    return 'processing';
  };
  // On failure the server reason is the most specific explanation, so it leads the
  // summary line; the provider message remains the fallback.
  const message = failed && error ? error : progress.message || progress.processingTaskName || t(`indexing.${failed ? 'failed' : progress.processingStatus === 'FINISH' ? 'ready' : 'processing'}`);

  return (
    <details className='min-w-0 text-xs text-muted-foreground'>
      <summary className={cn('cursor-pointer', align === 'start' ? 'text-start' : 'text-end', failed && 'text-destructive')} title={message}>
        <span role='status' className='inline-block max-w-40 truncate align-bottom sm:max-w-64'>{t('indexing.step', { current: progress.currentStep, total: progress.totalSteps })} — {message}</span>
      </summary>
      <ol className='mt-2 space-y-1 ps-4' aria-label={t('indexing.steps')}>
        {progress.steps.map((step) => {
          const status = stepStatus(step.number);
          return (
            <li key={step.key || step.number} className={cn(status === 'failed' && 'text-destructive')} aria-current={status === 'processing' || status === 'failed' ? 'step' : undefined}>
              {step.number}. {step.name} — {t(`indexing.stepStatus.${status}`)}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
