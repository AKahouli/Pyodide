import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootWorkPanel } from './RootWorkPanel';
import { initialRootWorkState, useRootWorkStore } from '../rootWorkStore';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), events: vi.fn(), stop: vi.fn(), cancel: vi.fn(), result: vi.fn(), panel: vi.fn(), user: { id: 'owner' },
  stream: { streamingConversationId: null as string | null, streamingMessageId: null as string | null,
    messages: [] as Array<{ id: string }>, fetchMessages: vi.fn() } }));
vi.mock('../api', () => ({ fetchRootWork: mocks.fetch, fetchRootWorkEvents: mocks.events, stopRootWork: mocks.stop,
  cancelRootBackgroundJob: mocks.cancel, fetchRootResult: mocks.result, fetchMessage: vi.fn() }));
vi.mock('../store', () => ({ useConversationStore: Object.assign(
  (selector: (state: typeof mocks.stream) => unknown) => selector(mocks.stream), { getState: () => mocks.stream }) }));
vi.mock('../uiStore', () => ({ useConversationUiStore: (selector: (state: unknown) => unknown) => selector({ setContextPanel: mocks.panel, requestOutlineScroll: vi.fn() }) }));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
const snapshot = { epoch: 4, watermark: '10', stopRequestId: 'stop-id', jobs: [
  { executionId: 'job', parentExecutionId: 'root', role: 'fanout_driver', status: 'running', task: 'Compare documents', createdAt: 'created', deadline: 'deadline' },
] };
function Work() { return <><RootWorkPanel conversationId='conversation' creatorId='owner' /><RootWorkPanel variant='details' conversationId='conversation' creatorId='owner' /></>; }

describe('Background work dock and details', () => {
  beforeEach(() => {
    vi.clearAllMocks(); useRootWorkStore.setState(initialRootWorkState); mocks.user.id = 'owner';
    mocks.stream.streamingConversationId = null; mocks.stream.streamingMessageId = null;
    mocks.fetch.mockResolvedValue(snapshot); mocks.events.mockResolvedValue([]); mocks.stream.messages = [];
    mocks.stream.fetchMessages.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue({ applied: true, barrierEpoch: 5, markedCount: 1, foregroundCancellationPending: false });
  });
  it('keeps the dock compact and opens details without exposing cancellation or history', async () => {
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.openDetails' }));
    expect(mocks.panel).toHaveBeenCalledWith('work');
    expect(screen.queryByText('Compare documents')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'rootWork.stopAll' })).not.toBeInTheDocument();
  });
  it('shows foreground worker assignments without exposing background cancellation', async () => {
    mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [], foregroundWorkers: [{ ...snapshot.jobs[0],
      executionId: 'worker', role: 'temporary_worker', mode: 'foreground', task: 'Check PostgreSQL documentation',
    }] });
    render(<Work />);
    expect(await screen.findByText('Check PostgreSQL documentation')).toBeVisible();
    await userEvent.click(screen.getByText('rootWork.assignments'));
    expect(await screen.findByText('rootWork.temporaryWorkerLabel')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'rootWork.stopTaskLabel' })).not.toBeInTheDocument();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('shares one observer between dock and details and groups worker plus synthesis', async () => {
    mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [...snapshot.jobs, { ...snapshot.jobs[0], executionId: 'followup', role: 'followup' }] });
    render(<Work />);
    expect(await screen.findByText('Compare documents')).toBeVisible();
    expect(screen.getByText('rootWork.preparing')).toBeVisible();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.events).toHaveBeenCalledTimes(1);
  });
  it('stops all with the bound foreground identity and retains a pending retry across panel remount', async () => {
    mocks.stream.streamingConversationId = 'conversation'; mocks.stream.streamingMessageId = 'original';
    mocks.stop.mockResolvedValueOnce({ applied: true, barrierEpoch: 5, markedCount: 1, foregroundCancellationPending: true });
    const view = render(<Work />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.stopAll' }));
    expect(await screen.findByRole('status')).toHaveTextContent('rootWork.cancellationPending');
    view.unmount(); mocks.stream.streamingMessageId = 'different'; render(<Work />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.retryCancellation' }));
    expect(mocks.stop).toHaveBeenLastCalledWith('conversation', { expectedEpoch: 4, stopRequestId: 'stop-id', foregroundMessageId: 'original' });
  });
  it('keeps failed actions visible without automatic retry', async () => {
    mocks.stop.mockRejectedValueOnce(new Error('offline')); render(<Work />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.stopAll' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
  it('recovers publication messages and leaves unread status intact when opening details', async () => {
    mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [{ ...snapshot.jobs[0], role: 'followup', status: 'completed', publicationMessageId: 'published' }] });
    render(<Work />);
    await waitFor(() => expect(mocks.stream.fetchMessages).toHaveBeenCalledWith('conversation'));
    expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['published']);
  });
  it('does not request private work for another reader', () => {
    mocks.user.id = 'member'; render(<Work />); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('refreshes final publication metadata even when a cached message already exists', async () => {
    mocks.stream.messages = [{ id: 'published' }];
    mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [{ ...snapshot.jobs[0], role: 'followup', status: 'completed', publicationMessageId: 'published' }] });
    render(<Work />);
    await waitFor(() => expect(mocks.stream.fetchMessages).toHaveBeenCalledTimes(1));
    expect(mocks.stream.fetchMessages).toHaveBeenCalledWith('conversation');
  });
  it('does not repeatedly hydrate historical publications outside the loaded message page', async () => {
    vi.useFakeTimers();
    try {
      mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [{ ...snapshot.jobs[0], role: 'followup', status: 'completed', publicationMessageId: 'old' }] });
      render(<Work />);
      await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
      expect(mocks.fetch).toHaveBeenCalledTimes(4);
      expect(mocks.stream.fetchMessages).toHaveBeenCalledTimes(1);
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(mocks.stream.fetchMessages).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });});
