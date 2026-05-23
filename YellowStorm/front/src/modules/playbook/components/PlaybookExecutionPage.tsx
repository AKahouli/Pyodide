import { useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

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
  const navigate = useNavigate();
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
  const selectedIterationIndex = usePlaybookStore((s) => s.selectedIterationIndex);
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
    (taskId: string, iterationIndex?: number) => {
      selectStep(taskId, iterationIndex);
    },
    [selectStep],
  );

  const selectedResult = (() => {
    if (!execution) return null;
    const group = execution.taskResults.filter((tr) => tr.taskId === selectedStepId).sort((a, b) => a.order - b.order);
    return group[selectedIterationIndex] || group[0] || null;
  })();

  const handleOpenCanvasForAdvisorApply = useCallback(() => {
    if (!id || !execution) return;

    const taskId = selectedResult?.taskId || selectedStepId || '';
    const params = new URLSearchParams({ execution: execution.id });
    if (taskId) {
      params.set('task', taskId);
      params.set('iteration', String(selectedIterationIndex));
    }

    navigate(`/playbooks/${id}?${params.toString()}`);
  }, [execution, id, navigate, selectedIterationIndex, selectedResult?.taskId, selectedStepId]);

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
          selectedIterationIndex={selectedIterationIndex}
          onSelectStep={handleSelectStep}
        />
        <ExecutionStepDetail
          step={selectedResult}
          execution={execution}
          onOpenCanvasForAdvisorApply={handleOpenCanvasForAdvisorApply}
        />
      </div>
    </div>
  );
}
