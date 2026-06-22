import { useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useRespondInteraction } from '../query/hooks';
import type { WorkyPendingClarification } from '../types';

interface ApprovalModalProps {
  open: boolean;
  streamId: string;
  interaction: WorkyPendingClarification;
  onClose: () => void;
}

/**
 * Approval modal for gated actions. The UI cannot self-approve —
 * it always asks the owner. On `approve=true` the backend emits
 * `interaction.approved`; the runtime rebinds the gated tool and
 * resumes the branch. On `approve=false` the task is blocked /
 * superseded and the runtime triggers a replan.
 */
export function ApprovalModal({
  open,
  streamId,
  interaction,
  onClose,
}: ApprovalModalProps): JSX.Element | null {
  const { t: tWorky } = useModuleTranslation('worky');
  const respond = useRespondInteraction(streamId);
  const [comment, setComment] = useState('');

  if (!open) return null;

  const submit = async (approve: boolean) => {
    await respond.mutateAsync({
      interactionId: interaction.id,
      content: comment || (approve ? 'approved' : 'rejected'),
      approve,
    });
    setComment('');
    onClose();
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4'
      role='dialog'
      aria-modal='true'
      data-testid='approval-modal'
    >
      <div className='w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg'>
        <h2 className='mb-2 text-base font-semibold'>{tWorky('approval.title')}</h2>
        <p className='mb-3 text-sm text-muted-foreground'>{interaction.question}</p>
        {interaction.options.length > 0 ? (
          <ul className='mb-3 flex flex-wrap gap-2'>
            {interaction.options.map((opt) => (
              <li key={opt}>
                <button
                  type='button'
                  className='rounded-md border border-border bg-background px-2 py-1 text-xs'
                  onClick={() => setComment((c) => (c ? `${c}; ${opt}` : opt))}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className='mb-3 block text-xs font-medium text-muted-foreground'>
          {tWorky('approval.comment_label')}
          <textarea
            className='mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            className='rounded-md border border-border bg-background px-3 py-1.5 text-xs'
            onClick={onClose}
            disabled={respond.isPending}
          >
            {tWorky('approval.cancel')}
          </button>
          <button
            type='button'
            className='rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs text-destructive'
            onClick={() => void submit(false)}
            disabled={respond.isPending}
            data-testid='approval-reject'
          >
            {tWorky('approval.reject')}
          </button>
          <button
            type='button'
            className='rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
            onClick={() => void submit(true)}
            disabled={respond.isPending}
            data-testid='approval-approve'
          >
            {tWorky('approval.approve')}
          </button>
        </div>
      </div>
    </div>
  );
}
