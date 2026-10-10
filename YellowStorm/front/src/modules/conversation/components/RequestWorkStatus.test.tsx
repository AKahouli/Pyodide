import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { RequestWorkStatus } from './RequestWorkStatus';
import { WorkDisclosure } from './WorkDisclosure';
import { initialRootWorkState, useRootWorkStore } from '../rootWorkStore';
const open = vi.fn();
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string, args?: object) => key + (args ? JSON.stringify(args) : '') }) }));
vi.mock('../uiStore', () => ({ useConversationUiStore: (selector: (state: unknown) => unknown) => selector({ setContextPanel: open }) }));
beforeEach(() => { useRootWorkStore.setState(initialRootWorkState); open.mockClear(); });
it('keeps queued and waiting execution rows visible without a running spinner', () => {
  useRootWorkStore.setState({ userId: 'owner', snapshots: { conversation: { epoch: 1, watermark: '1', stopRequestId: 'stop', jobs: [{
    executionId: 'job', parentExecutionId: 'root', role: 'temporary_worker', originAssistantMessageId: 'ack', status: 'queued', createdAt: '', deadline: '',
  }] } } });
  const view = render(<RequestWorkStatus conversationId='conversation' messageId='ack' />);
  expect(screen.getByRole('status')).toHaveTextContent('rootWork.status.queued');
  expect(view.container.querySelector('.animate-spin')).toBeNull();
  act(() => useRootWorkStore.setState({ snapshots: { conversation: { epoch: 1, watermark: '2', stopRequestId: 'stop', jobs: [{
    executionId: 'job', parentExecutionId: 'root', role: 'temporary_worker', originAssistantMessageId: 'ack', status: 'waiting', createdAt: '', deadline: '',
  }] } } }));
  view.rerender(<RequestWorkStatus conversationId='conversation' messageId='ack' />);
  expect(screen.getByRole('status')).toHaveTextContent('rootWork.status.waiting');
  expect(view.container.querySelector('.animate-spin')).toBeNull();
});
it('shows request-bound uncertain work in chat and opens its details without a spinner', async () => {
  useRootWorkStore.setState({ userId: 'owner', snapshots: { conversation: { epoch: 1, watermark: '1', stopRequestId: 'stop', jobs: [{
    executionId: 'batch', parentExecutionId: 'root', originAssistantMessageId: 'ack', role: 'fanout_driver',
    status: 'outcome_unknown', createdAt: '', deadline: '', fanoutItems: [
      { executionId: 'a', status: 'completed' }, { executionId: 'b', status: 'outcome_unknown' },
    ],
  }] } } });
  const view = render(<RequestWorkStatus conversationId='conversation' messageId='ack' />);
  expect(screen.getByText(/rootWork.unresolved/)).toHaveTextContent('"count":1');
  expect(screen.getByText(/rootWork.progress/)).toHaveTextContent('"total":2');
  expect(screen.queryByText('rootWork.canContinue')).not.toBeInTheDocument();
  expect(view.container.querySelector('.animate-spin')).toBeNull();
  await userEvent.click(screen.getByRole('button'));
  expect(open).toHaveBeenCalledWith('work');
  view.rerender(<RequestWorkStatus conversationId='conversation' messageId='unrelated' />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not mount collapsed details before first expansion', async () => {
  render(<WorkDisclosure label='Details'><span>Expensive content</span></WorkDisclosure>);
  expect(screen.queryByText('Expensive content')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Details'));
  expect(await screen.findByText('Expensive content')).toBeVisible();
});
it('shows running and queued batch counts while chatting remains available', () => {
  useRootWorkStore.setState({ userId: 'owner', snapshots: { conversation: { epoch: 1, watermark: '1', stopRequestId: 'stop', jobs: [{
    executionId: 'batch', parentExecutionId: 'root', originAssistantMessageId: 'ack', role: 'fanout_driver',
    status: 'running', createdAt: '', deadline: '', fanoutItems: [
      { executionId: 'a', status: 'running' }, { executionId: 'b', status: 'queued' },
    ],
  }] } } });
  const view = render(<RequestWorkStatus conversationId='conversation' messageId='ack' />);
  expect(screen.getByText(/rootWork.batchActivity/)).toHaveTextContent('"running":1,"queued":1');
  expect(screen.getByText('rootWork.canContinue')).toBeVisible();
  expect(view.container.querySelector('.animate-spin')).not.toBeNull();
});
