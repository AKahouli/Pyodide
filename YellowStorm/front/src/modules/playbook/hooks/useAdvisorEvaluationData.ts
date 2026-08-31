import { useCallback, useEffect, useRef, useState } from 'react';

import { getExecution, getExecutions } from '../api';
import type { PlaybookExecution } from '../types';

const RECENT_EXECUTION_COUNT = 10;
const EXECUTION_LIST_LIMIT = 20;

interface AdvisorEvaluationDataState {
  executions: PlaybookExecution[];
  loading: boolean;
  error: boolean;
  unavailableCount: number;
}

const initialState: AdvisorEvaluationDataState = {
  executions: [],
  loading: false,
  error: false,
  unavailableCount: 0,
};

export function useAdvisorEvaluationData(playbookId: string, enabled: boolean) {
  const [state, setState] = useState(initialState);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !playbookId) return;
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, loading: true, error: false, unavailableCount: 0 }));

    try {
      const { executions: summaries } = await getExecutions(playbookId, {
        page: 1,
        limit: EXECUTION_LIST_LIMIT,
      });
      const completed = summaries
        .filter((execution) => execution.status === 'completed')
        .sort((left, right) => right.executionNumber - left.executionNumber)
        .slice(0, RECENT_EXECUTION_COUNT);
      const details = await Promise.allSettled(
        completed.map(async (summary) => {
          const detail = await getExecution(playbookId, summary.id);
          return {
            ...detail,
            executionNumber: summary.executionNumber,
            startedAt: detail.startedAt ?? summary.startedAt,
            completedAt: detail.completedAt ?? summary.completedAt,
          };
        }),
      );
      if (requestId !== requestIdRef.current) return;

      const executions = details
        .filter((result): result is PromiseFulfilledResult<PlaybookExecution> => result.status === 'fulfilled')
        .map((result) => result.value)
        .sort((left, right) => right.executionNumber - left.executionNumber);
      setState({
        executions,
        loading: false,
        error: false,
        unavailableCount: details.length - executions.length,
      });
    } catch {
      if (requestId !== requestIdRef.current) return;
      setState({ ...initialState, error: true });
    }
  }, [enabled, playbookId]);

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1;
      setState(initialState);
      return;
    }
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [enabled, load]);

  return { ...state, refresh: load };
}
