import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { ApprovalModal } from './ApprovalModal';

const STREAM_ID = 'stream-1';
const INTERACTION = {
  id: 'iact-1',
  type: 'approval',
  question: 'Send this email to the customer?',
  options: ['Yes', 'No'],
  taskId: 't-1',
  blocksTaskIds: ['t-1'],
};
const respondCalls: Array<{ id: string; content: string; approve?: boolean }> = [];

vi.mock('../query/hooks', () => ({
  useRespondInteraction: () => ({
    mutateAsync: async (input: { interactionId: string; content: string; approve?: boolean }) => {
      respondCalls.push({
        id: input.interactionId,
        content: input.content,
        approve: input.approve,
      });
    },
    isPending: false,
  }),
}));

function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}

function renderModal() {
  return render(
    <TestProviders>
      <ApprovalModal
        open
        streamId={STREAM_ID}
        interaction={INTERACTION}
        onClose={vi.fn()}
      />
    </TestProviders>,
  );
}

beforeEach(() => {
  respondCalls.length = 0;
});

describe('ApprovalModal', () => {
  it('renders the question', () => {
    renderModal();
    expect(screen.getByText('Send this email to the customer?')).toBeDefined();
  });

  it('Approve button sends approve=true', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('approval-approve'));
    await waitFor(() => {
      expect(respondCalls).toHaveLength(1);
    });
    expect(respondCalls[0].approve).toBe(true);
    expect(respondCalls[0].id).toBe('iact-1');
  });

  it('Reject button sends approve=false', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('approval-reject'));
    await waitFor(() => {
      expect(respondCalls).toHaveLength(1);
    });
    expect(respondCalls[0].approve).toBe(false);
  });

  it('Approve with a comment sends the comment as content', async () => {
    renderModal();
    const textarea = screen.getByLabelText('approval.comment_label') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByTestId('approval-approve'));
    await waitFor(() => {
      expect(respondCalls[0].content).toBe('Looks good');
    });
    expect(respondCalls[0].approve).toBe(true);
  });

  it('UI cannot self-approve silently — it always invokes respondInteraction', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('approval-approve'));
    await waitFor(() => {
      expect(respondCalls).toHaveLength(1);
    });
  });
});
