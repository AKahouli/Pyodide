import { useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';

import { Loader2 } from 'lucide-react';
import {
  usePlaybookStore,
  useCurrentPlaybook,
  useCurrentExecution,
  useCurrentExecutionLoading,
  useLatestExecutionForPlaybook,
  useSelectedStep,
} from '../store';
import { ExecutionHeader } from './ExecutionHeader';
import { ExecutionStepList } from './ExecutionStepList';
import { ExecutionStepDetail } from './ExecutionStepDetail';
import { useModuleTranslation } from '@/modules/localization';

export function PlaybookExecutionPage() {
  const { id, executionId } = useParams<{ id: string; executionId: string }>();
  const { t } = useModuleTranslation('playbook');

  const playbook = useCurrentPlaybook();
  const currentExecution = useCurrentExecution();
  const latestExecution = useLatestExecutionForPlaybook(id);
  const execution = currentExecution?.id === executionId && currentExecution?.playbookId === id
    ? currentExecution
    : latestExecution?.id === executionId
      ? latestExecution
      : null;
  const executionLoading = useCurrentExecutionLoading();
  const selectedStepId = useSelectedStep();
  const fetchPlaybook = usePlaybookStore((s) => s.fetchPlaybook);
  const fetchExecution = usePlaybookStore((s) => s.fetchExecution);
  const fetchExecutions = usePlaybookStore((s) => s.fetchExecutions);
  const selectStep = usePlaybookStore((s) => s.selectStep);

  useEffect(() => {
    if (id) {
      fetchPlaybook(id);
      fetchExecutions(id);
    }
  }, [id, fetchPlaybook, fetchExecutions]);

  useEffect(() => {
    if (id && executionId) {
      fetchExecution(id, executionId);
    }
  }, [id, executionId, fetchExecution]);

  const handleSelectStep = useCallback(
    (taskId: string) => {
      selectStep(taskId);
    },
    [selectStep],
  );

  const selectedResult = execution?.taskResults.find(
    (tr) => tr.taskId === selectedStepId,
  ) || null;

  if (!execution || executionLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <ExecutionHeader execution={execution} playbook={playbook} />

      <div className="flex flex-1 min-h-0">
        <ExecutionStepList
          taskResults={execution.taskResults}
          selectedStepId={selectedStepId}
          onSelectStep={handleSelectStep}
        />
        <ExecutionStepDetail step={selectedResult} execution={execution} />
      </div>
    </div>
  );
}
