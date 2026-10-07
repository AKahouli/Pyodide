import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingApprovalCard } from './PendingApprovalCard';
import type { WorkyPendingApproval } from '../../executive/executiveModel';

const mutate = vi.fn();

vi.mock('../../query/hooks', () => ({
  useSendMessage: () => ({ mutate, mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../store', () => ({
  useWorkyStore: (selector: (s: unknown) => unknown) =>
    selector({ beginTurn: vi.fn(), finishTurn: vi.fn(), markConfirmSubmitted: vi.fn() }),
}));
vi.mock('../../uiStore', () => ({
  useWorkyUiStore: (selector: (s: unknown) => unknown) => selector({ notifySendError: vi.fn() }),
}));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

function emailApproval(): WorkyPendingApproval {
  const questionId = 'confirm::fc-1';
  return {
    questionId,
    component: {
      id: 'component-1',
      type: 'choice',
      data: {
        schemaVersion: 1,
        status: 'ready',
        questionId,
        prompt: "Approuver l'envoi de cet e-mail ?",
        presentation: 'quick_replies',
        selectionMode: 'single',
        submitBehavior: 'immediate',
        editable: true,
        fields: [
          { key: 'to_recipients', label: 'À', value: 'agara@yellowsys.fr' },
          { key: 'subject', label: 'Objet', value: 'Worky — améliorations' },
          { key: 'body', label: 'Message', value: 'Bonjour Amine', multiline: true, markdown: true },
        ],
        options: [
          { id: 'approve', label: 'Approuver', submitText: 'approve' },
          { id: 'decline', label: 'Refuser', submitText: 'decline' },
        ],
      },
    },
  };
}

describe('PendingApprovalCard', () => {
  beforeEach(() => mutate.mockReset());

  it('summarizes the send as an email row with recipient and subject', () => {
    render(<PendingApprovalCard streamId='s1' approval={emailApproval()} />);
    expect(screen.getByText('executive.needsYou.approvalEmail')).toBeInTheDocument();
    expect(screen.getByText(/agara@yellowsys\.fr/)).toBeInTheDocument();
    expect(screen.getByText('Worky — améliorations')).toBeInTheDocument();
  });

  it('approving from the row submits the confirm-gate verdict for THIS questionId', async () => {
    render(<PendingApprovalCard streamId='s1' approval={emailApproval()} />);
    await userEvent.click(screen.getByText('approval.approve'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [payload] = mutate.mock.calls[0];
    expect(JSON.parse(payload.content)).toEqual({
      verdict: 'approve',
      questionId: 'confirm::fc-1',
      edits: { to_recipients: 'agara@yellowsys.fr', subject: 'Worky — améliorations', body: 'Bonjour Amine' },
    });
  });

  it('rejecting from the row carries no edits', async () => {
    render(<PendingApprovalCard streamId='s1' approval={emailApproval()} />);
    await userEvent.click(screen.getByText('approval.reject'));

    const [payload] = mutate.mock.calls[0];
    expect(JSON.parse(payload.content)).toEqual({ verdict: 'decline', questionId: 'confirm::fc-1' });
  });

  it('edits made in the preview are carried by the row Approve', async () => {
    render(<PendingApprovalCard streamId='s1' approval={emailApproval()} />);
    await userEvent.click(screen.getByText('executive.needsYou.approvalReview')); // expand
    await userEvent.click(screen.getByText('approval.edit'));
    const subjectInput = screen.getByDisplayValue('Worky — améliorations');
    await userEvent.clear(subjectInput);
    await userEvent.type(subjectInput, 'Sujet corrigé');
    await userEvent.click(screen.getByText('approval.approve'));

    const [payload] = mutate.mock.calls[0];
    expect(JSON.parse(payload.content).edits.subject).toBe('Sujet corrigé');
  });
});
