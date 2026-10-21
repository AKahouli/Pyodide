import { FileIndexingDuration } from './FileIndexingDuration';
import { FileIndexingProgress } from './FileIndexingProgress';
import { WorkspaceIndexingStatus } from './WorkspaceIndexingStatus';
import type { WorkspaceFile } from '../types';

/**
 * The compact indexing state of one file: its status and, while the attempt runs or
 * once it ended, the elapsed processing time reported by the server.
 */
export function FileIndexingStatusLine({ file }: { file: WorkspaceFile }) {
  return (
    <span className='flex items-center gap-1.5'>
      <WorkspaceIndexingStatus file={file} />
      <FileIndexingDuration
        status={file.indexingStatus}
        indexingAttemptStartedAt={file.indexingAttemptStartedAt}
        indexingAttemptCompletedAt={file.indexingAttemptCompletedAt}
      />
    </span>
  );
}

/**
 * The step schedule of one file, as reported by the indexing service.
 *
 * The schedule is shown only when it still describes the current outcome: a schedule
 * left behind by an earlier run never contradicts the status line. A failed file keeps
 * its reason readable, because the status alone does not say what went wrong.
 */
export function FileIndexingSteps({ file }: { file: WorkspaceFile }) {
  const progress = file.indexingProgress;
  const failed = file.indexingStatus === 'failed';
  const reason = failed ? file.indexingError : undefined;
  const scheduleIsCurrent = !!progress
    && !(failed && progress.processingStatus !== 'FAIL')
    && !(file.indexingStatus === 'ready' && progress.processingStatus !== 'FINISH');
  if (scheduleIsCurrent) {
    return <FileIndexingProgress progress={progress} status={file.indexingStatus} error={reason} align='start' />;
  }
  // Without a usable schedule the failure reason replaces the schedule; a file that
  // simply has no schedule yet is already covered by its status line.
  if (failed && reason) return <FileIndexingProgress status={file.indexingStatus} error={reason} align='start' />;
  return null;
}
