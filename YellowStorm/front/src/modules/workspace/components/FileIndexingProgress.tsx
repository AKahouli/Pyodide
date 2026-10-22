import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { IndexingProgress, IndexingStatus } from '../types';
import { INDEXING_TONE, type IndexingTone } from './indexing-status-tone';

/**
 * The server owns the schedule and final result, including failure on the last step.
 * `align` places the summary line: the schedule sits under the file name in the file
 * list, and beside the status when the row itself is right-aligned.
 */
export function FileIndexingProgress({ progress, status, error, align = 'end' }: { progress?: IndexingProgress | null; status?: IndexingStatus; error?: string; align?: 'start' | 'end' }) {
  const { t } = useModuleTranslation('workspace');
  // A legacy terminal update can end a workflow without a fresh detailed step.
  if (!progress || (status === 'failed' && progress.processingStatus !== 'FAIL') || (status === 'ready' && progress.processingStatus !== 'FINISH')) {
    const tone: IndexingTone = status === 'failed' ? 'failed' : status === 'ready' ? 'done' : status === 'pending' || status === 'processing' ? 'inProgress' : 'idle';
    return <p role='status' title={error} className={cn('max-w-40 truncate text-xs sm:max-w-64', INDEXING_TONE[tone].text)}>{error || t(`indexing.${status ?? 'none'}`)}</p>;
  }
  // The file's own outcome decides the colour. A schedule that still reports a failure
  // while the file runs again is stale, and must not paint a running file red.
  const running = status === 'processing' || status === 'pending';
  const failed = running ? false : status === 'failed' || progress.processingStatus === 'FAIL' || progress.stepStatus === 'FAIL';
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
  // The summary carries the colour of the whole workflow, each step the colour of
  // its own state, so the schedule reads the same way as the status of the file.
  const workflowTone: IndexingTone = failed ? 'failed' : status === 'ready' ? 'done' : 'inProgress';
  const stepTone: Record<string, IndexingTone> = { completed: 'done', processing: 'inProgress', failed: 'failed', pending: 'idle' };

  return (
    <details className='min-w-0 text-xs text-muted-foreground'>
      <summary className={cn('cursor-pointer', align === 'start' ? 'text-start' : 'text-end', INDEXING_TONE[workflowTone].text)} title={message}>
        <span role='status' className='inline-block max-w-40 truncate align-bottom sm:max-w-64'>{t('indexing.step', { current: progress.currentStep, total: progress.totalSteps })} — {message}</span>
      </summary>
      <ol className='mt-2 space-y-1 ps-4' aria-label={t('indexing.steps')}>
        {progress.steps.map((step) => {
          const status = stepStatus(step.number);
          return (
            <li key={step.key || step.number} className={cn(INDEXING_TONE[stepTone[status] ?? 'idle'].text)} aria-current={status === 'processing' || status === 'failed' ? 'step' : undefined}>
              {step.number}. {step.name} — {t(`indexing.stepStatus.${status}`)}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
