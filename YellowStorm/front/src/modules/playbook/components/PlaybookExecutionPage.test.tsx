import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookExecutionPage } from './PlaybookExecutionPage';

const mocks = vi.hoisted(() => ({
  selectStep: vi.fn(),
  fetchPlaybook: vi.fn(),
  fetchExecutions: vi.fn(),
  fetchExecution: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'playbook-1', executionId: 'execution-1' }),
  useSearchParams: () => [new URLSearchParams('taskId=task%2F1&mascotHighlight=1')],
}));

vi.mock('../store', () => ({
  useCurrentPlaybook: () => null,
  useCurrentExecution: () => null,
  useCurrentExecutionLoading: () => true,
  useLatestExecutionForPlaybook: () => null,
  useSelectedStep: () => null,
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    selectedIterationIndex: 0,
    selectStep: mocks.selectStep,
    fetchPlaybook: mocks.fetchPlaybook,
    fetchExecutions: mocks.fetchExecutions,
    fetchExecution: mocks.fetchExecution,
  }),
}));

vi.mock('./ExecutionHeader', () => ({ ExecutionHeader: () => null }));
vi.mock('./ExecutionStepList', () => ({ ExecutionStepList: () => null }));
vi.mock('./ExecutionStepDetail', () => ({ ExecutionStepDetail: () => null }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('PlaybookExecutionPage assistant task handoff', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects the task requested by the semantic navigation target', async () => {
    render(<PlaybookExecutionPage />);

    await waitFor(() => expect(mocks.selectStep).toHaveBeenCalledWith('task/1'));
  });
});
