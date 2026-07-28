import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { StreamModelsControl } from './StreamModelsControl';
import type { WorkyStream } from '../types';

const mutate = vi.fn();

vi.mock('../query/hooks', () => ({
  useUpdateStream: () => ({ mutate, isPending: false }),
}));

vi.mock('@/modules/models', () => ({
  useModels: () => [],
  useChefs: () => [],
  useModelsInitialized: () => true,
}));

const STREAM: WorkyStream = {
  id: 'stream-1',
  ownerUserId: 'u1',
  workspaceId: 'w1',
  artifactWorkspaceId: 'aw1',
  managerAgentId: 'a1',
  plannerModelId: null,
  executorModelId: null,
  plannerPrompt: null,
  executorPrompt: null,
  title: 'S',
  status: 'created' as never,
  controlState: 'active' as never,
  schedulerEnabled: false,
  currentPlanVersion: 0,
  budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  activeDurationMinutes: 0,
  createdAt: 'now',
  updatedAt: 'now',
  lastActivityAt: 'now',
};

function renderControl(stream: WorkyStream = STREAM) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LocalizationProvider>
        <StreamModelsControl stream={stream} />
      </LocalizationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => mutate.mockReset());

describe('StreamModelsControl', () => {
  it('renders the two prompt textareas', () => {
    renderControl();
    expect(screen.getByTestId('stream-planner-prompt')).toBeTruthy();
    expect(screen.getByTestId('stream-executor-prompt')).toBeTruthy();
  });

  it('persists the planner prompt on blur when it changed', () => {
    renderControl();
    const ta = screen.getByTestId('stream-planner-prompt');
    fireEvent.change(ta, { target: { value: 'Plan carefully' } });
    fireEvent.blur(ta);
    expect(mutate).toHaveBeenCalledWith({
      streamId: 'stream-1',
      data: { plannerPrompt: 'Plan carefully' },
    });
  });

  it('does not persist when the prompt is unchanged', () => {
    renderControl();
    fireEvent.blur(screen.getByTestId('stream-executor-prompt'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('clears the prompt to null when emptied', () => {
    renderControl({ ...STREAM, plannerPrompt: 'old' });
    const ta = screen.getByTestId('stream-planner-prompt');
    fireEvent.change(ta, { target: { value: '   ' } });
    fireEvent.blur(ta);
    expect(mutate).toHaveBeenCalledWith({
      streamId: 'stream-1',
      data: { plannerPrompt: null },
    });
  });
});
