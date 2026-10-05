import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootWorkPanel } from './RootWorkPanel';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), events: vi.fn(), stop: vi.fn(), user: { id: 'owner' },
  stream: { streamingConversationId: null as string | null, streamingMessageId: null as string | null,
    messages: [] as Array<{ id: string }>, fetchMessages: vi.fn() } }));
vi.mock('../api', () => ({ fetchRootWork: mocks.fetch, fetchRootWorkEvents: mocks.events, stopRootWork: mocks.stop }));
vi.mock('../store', () => ({ useConversationStore: Object.assign(
  (selector: (state: typeof mocks.stream) => unknown) => selector(mocks.stream), { getState: () => mocks.stream }) }));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

const snapshot = { epoch: 4, watermark: '10', stopRequestId: 'stop-id', jobs: [
  { executionId: 'job', parentExecutionId: 'root', role: 'fanout_driver', status: 'outcome_unknown', createdAt: 'created', deadline: 'deadline' },
] };

describe('Durable background work controls', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.user.id = 'owner'; mocks.stream.streamingConversationId = null; mocks.stream.streamingMessageId = null;
    mocks.fetch.mockResolvedValue(snapshot);
    mocks.events.mockResolvedValue([]);
    mocks.stream.messages = [];
    mocks.stream.fetchMessages.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue({ applied: true, barrierEpoch: 5, markedCount: 1, foregroundCancellationPending: false });
  });

  it('shows an uncertain background outcome and stops it after the foreground stream has finished', async () => {
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    const button = await screen.findByRole('button', { name: 'rootWork.stopAll' });
    expect(screen.getByText(/rootWork.status.outcome_unknown/)).toBeVisible();
    await userEvent.click(button);
    expect(mocks.stop).toHaveBeenCalledWith('conversation', { expectedEpoch: 4, stopRequestId: 'stop-id' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'rootWork.stopAll' })).not.toBeInTheDocument());
  });

  it('includes only the currently bound foreground message when stopping all work', async () => {
    mocks.stream.streamingConversationId = 'conversation'; mocks.stream.streamingMessageId = 'message';
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.stopAll' }));
    expect(mocks.stop).toHaveBeenCalledWith('conversation', { expectedEpoch: 4, stopRequestId: 'stop-id', foregroundMessageId: 'message' });
  });

  it('keeps a failed Stop visible and does not retry it automatically', async () => {
    mocks.stop.mockRejectedValueOnce(new Error('offline'));
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.stopAll' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'rootWork.stopAll' })).toBeEnabled();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps pending cancellation visible and retries only the original Stop identity', async () => {
    mocks.stream.streamingConversationId = 'conversation'; mocks.stream.streamingMessageId = 'original';
    mocks.stop.mockResolvedValueOnce({ applied: true, barrierEpoch: 5, markedCount: 1, foregroundCancellationPending: true });
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootWork.stopAll' }));
    expect(await screen.findByRole('status')).toHaveTextContent('rootWork.cancellationPending');
    mocks.stream.streamingMessageId = 'new-message';
    await userEvent.click(screen.getByRole('button', { name: 'rootWork.retryCancellation' }));
    expect(mocks.stop).toHaveBeenLastCalledWith('conversation', {
      expectedEpoch: 4, stopRequestId: 'stop-id', foregroundMessageId: 'original' });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('recovers a published message from the current snapshot before older replay pages catch up', async () => {
    mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [{ ...snapshot.jobs[0], role: 'followup',
      status: 'completed', publicationMessageId: 'published-message' }] });
    mocks.stream.fetchMessages.mockImplementationOnce(async () => { mocks.stream.messages = [{ id: 'published-message' }]; });
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    await waitFor(() => expect(mocks.stream.fetchMessages).toHaveBeenCalledWith('conversation'));
    expect(mocks.events).toHaveBeenCalledWith('conversation', 4, '0', expect.any(AbortSignal));
  });

  it('does not request private work for another conversation reader', () => {
    mocks.user.id = 'member';
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('recovers failed work from a reload snapshot without replay events or a Stop action', async () => {
    mocks.fetch.mockResolvedValue({ ...snapshot, jobs: [{ ...snapshot.jobs[0], role: 'library_worker', status: 'failed' }] });
    render(<RootWorkPanel conversationId='conversation' creatorId='owner' />);
    expect(await screen.findByText(/rootWork.status.failed/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'rootWork.stopAll' })).not.toBeInTheDocument();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
});
