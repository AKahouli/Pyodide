import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { RootBackgroundJobRow } from './RootBackgroundJobRow';
import type { RootWorkSnapshot } from '../types';
const mocks = vi.hoisted(() => ({ cancel: vi.fn(), result: vi.fn(), refresh: vi.fn() }));
vi.mock('../api', () => ({ cancelRootBackgroundJob: mocks.cancel, fetchRootResult: mocks.result }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
const job: RootWorkSnapshot['jobs'][number] = { executionId: 'worker', parentExecutionId: 'request', role: 'temporary_worker', status: 'running', task: 'Compare documents', createdAt: '', deadline: '' };
beforeEach(() => vi.clearAllMocks());
it('cancels the selected execution with its epoch and prevents duplicate cancellation', async () => {
  mocks.cancel.mockResolvedValue({ cancellationRequested: true });
  render(<ul><RootBackgroundJobRow job={job} conversationId='conversation' epoch={7} onCancelled={mocks.refresh} /></ul>);
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.stopTaskLabel' }));
  expect(mocks.cancel).toHaveBeenCalledWith('conversation', 'worker', { expectedEpoch: 7 });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'rootWork.stopTaskLabel' })).toBeDisabled();
});
it('retains errors for explicit retry', async () => {
  mocks.cancel.mockRejectedValue(new Error('offline'));
  render(<ul><RootBackgroundJobRow job={job} conversationId='conversation' epoch={7} onCancelled={mocks.refresh} /></ul>);
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.stopTaskLabel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(screen.getByRole('button', { name: 'rootWork.stopTaskLabel' })).toBeEnabled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('loads committed output on demand and labels an incomplete result', async () => {
  mocks.result.mockResolvedValue({ executionId: 'worker', text: 'Committed output', complete: false });
  render(<ul><RootBackgroundJobRow job={{ ...job, status: 'completed' }} conversationId='conversation' epoch={7} onCancelled={mocks.refresh} /></ul>);
  expect(mocks.result).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.viewFullResult' }));
  expect(await screen.findByText('Committed output')).toBeVisible();
  expect(screen.getByText('rootWork.partialResult')).toBeVisible();
});
it('allows inspection of completed fanout item output', async () => {
  mocks.result.mockResolvedValue({ executionId: 'item', text: 'Item output', complete: true });
  render(<ul><RootBackgroundJobRow job={{ ...job, fanoutItems: [{ executionId: 'item', label: 'Document one', status: 'completed' }] }} conversationId='conversation' epoch={7} onCancelled={mocks.refresh} /></ul>);
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.viewFullResult' }));
  expect(mocks.result).toHaveBeenCalledWith('conversation', 'item');
  expect(await screen.findByText('Item output')).toBeVisible();
});
