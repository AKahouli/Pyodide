import { useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import {
  useConfirmMemoryProposal,
  useMemoryProposals,
  useRejectMemoryProposal,
} from '../query/hooks';
import type { WorkyMemoryProposal } from '../types';

/**
 * Pending + decided memory proposals (Part 4 §7, canonical §21).
 * Confirming writes the durable `WorkyMemoryEntry`; rejecting writes
 * nothing. The UI never auto-confirms — the owner must click.
 */
export function MemoryProposalCard() {
  const { t } = useModuleTranslation('worky');
  const { data: pending = [], isLoading } = useMemoryProposals('pending');
  const confirm = useConfirmMemoryProposal();
  const reject = useRejectMemoryProposal();
  const [reason, setReason] = useState('');

  if (isLoading) {
    return <div data-testid="memory-loading">{t('memory.loading')}</div>;
  }
  if (pending.length === 0) {
    return (
      <div data-testid="memory-empty" className="p-3 text-sm text-gray-500">
        {t('memory.empty')}
      </div>
    );
  }

  return (
    <div data-testid="memory-proposals" className="space-y-2 p-3">
      <h3 className="text-sm font-semibold">{t('memory.proposalsTitle')}</h3>
      {pending.map((proposal: WorkyMemoryProposal) => (
        <div
          key={proposal.id}
          data-testid="memory-proposal"
          className="rounded border border-gray-200 bg-white p-3 text-sm"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{proposal.title}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {t(`memory.categories.${proposal.category}`)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600">{proposal.content}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="memory-confirm"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate(proposal.id)}
              className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
            >
              {t('memory.confirm')}
            </button>
            <input
              type="text"
              data-testid="memory-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('memory.rejectReasonPlaceholder')}
              className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
            />
            <button
              type="button"
              data-testid="memory-reject"
              disabled={reject.isPending}
              onClick={() => {
                reject.mutate({ id: proposal.id, reason });
                setReason('');
              }}
              className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {t('memory.reject')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
