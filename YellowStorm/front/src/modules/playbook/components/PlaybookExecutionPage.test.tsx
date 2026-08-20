import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookExecutionPage } from './PlaybookExecutionPage';

const mocks = vi.hoisted(() => ({
  selectStep: vi.fn(),
  fetchPlaybook: vi.fn(),
  fetchExecutions: vi.fn(),
  fetchExecution: vi.fn(),
  setSearchParams: vi.fn(),
  search: 'taskId=task%2F1&mascotTask=task%2F1',
  execution: null as null | { id: string; playbookId: string; status: string; taskResults: unknown[] },
  executionLoading: true,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'playbook-1', executionId: 'execution-1' }),
  useSearchParams: () => [new URLSearchParams(mocks.search), mocks.setSearchParams],
}));

vi.mock('../store', () => ({
  useCurrentPlaybook: () => null,
  useCurrentExecution: () => mocks.execution,
  useCurrentExecutionLoading: () => mocks.executionLoading,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = 'taskId=task%2F1&mascotTask=task%2F1';
    mocks.execution = null;
    mocks.executionLoading = true;
  });

  it('selects the task requested by the semantic navigation target', async () => {
    render(<PlaybookExecutionPage />);

    await waitFor(() => expect(mocks.selectStep).toHaveBeenCalledWith('task/1'));
    const consumed = mocks.setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(consumed.has('mascotTask')).toBe(false);
  });

  it('focuses execution status and consumes the semantic focus effect', async () => {
    mocks.search = 'mascotFocusStatus=1';
    mocks.execution = { id: 'execution-1', playbookId: 'playbook-1', status: 'failed', taskResults: [] };
    mocks.executionLoading = false;

    render(<PlaybookExecutionPage />);

    await waitFor(() => expect(document.activeElement?.id).toBe('playbook-execution-status'));
    const consumed = mocks.setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(consumed.has('mascotFocusStatus')).toBe(false);
  });
});
