import { useState, useEffect } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useStreamBudget, useUpdateStreamBudget } from '../query/hooks';

interface BudgetControlProps {
  streamId: string;
}

/**
 * Stream-level budget control (Part 4 §4.3). Shows the live
 * `limitUsd` / `spendUsd` / `tokensUsed`, and lets the owner edit the
 * limit + enforcement. Editable only when the stream is in a
 * non-terminal phase. `hard_stop` is the MVP default.
 */
export function BudgetControl({ streamId }: BudgetControlProps) {
  const { t } = useModuleTranslation('worky');
  const { data: budget, isLoading } = useStreamBudget(streamId);
  const updateBudget = useUpdateStreamBudget(streamId);
  const [editMode, setEditMode] = useState(false);
  const [draftUsd, setDraftUsd] = useState(0);
  const [draftTokens, setDraftTokens] = useState(0);
  const [draftEnforcement, setDraftEnforcement] = useState<'hard_stop' | 'notify'>('hard_stop');

  useEffect(() => {
    if (budget) {
      setDraftUsd(budget.limitUsd);
      setDraftTokens(budget.limitTokens);
      setDraftEnforcement(budget.enforcement);
    }
  }, [budget]);

  if (isLoading || !budget) {
    return <div data-testid="budget-loading">{t('budget.loading')}</div>;
  }

  const percent = budget.limitUsd > 0
    ? Math.min(100, (budget.spendUsd / budget.limitUsd) * 100)
    : 0;
  const save = () => {
    updateBudget.mutate({
      limitUsd: draftUsd,
      limitTokens: draftTokens,
      enforcement: draftEnforcement,
    });
    setEditMode(false);
  };

  return (
    <div
      data-testid="budget-control"
      className="rounded-lg border border-gray-200 bg-white p-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{t('budget.title')}</span>
        {!editMode ? (
          <button
            type="button"
            data-testid="budget-edit"
            onClick={() => setEditMode(true)}
            className="text-blue-600 hover:underline"
          >
            {t('budget.edit')}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="budget-cancel"
              onClick={() => setEditMode(false)}
              className="text-gray-600 hover:underline"
            >
              {t('budget.cancel')}
            </button>
            <button
              type="button"
              data-testid="budget-save"
              onClick={save}
              className="text-blue-600 hover:underline"
            >
              {t('budget.save')}
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span>
          ${budget.spendUsd.toFixed(4)} /{' '}
          {budget.limitUsd > 0 ? `$${budget.limitUsd.toFixed(2)}` : t('budget.unlimited')}
        </span>
        <span className="text-xs text-gray-500">
          {t('budget.tokensUsed', { count: budget.tokensUsed })}
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-100"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          data-testid="budget-bar"
          className="h-full"
          style={{
            width: `${percent}%`,
            backgroundColor: budget.exhausted ? '#dc2626' : '#16a34a',
          }}
        />
      </div>
      {editMode && (
        <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="w-24 text-gray-500">{t('budget.limitUsd')}</span>
            <input
              data-testid="budget-limit-usd"
              type="number"
              min={0}
              step="0.01"
              value={draftUsd}
              onChange={(e) => setDraftUsd(Number(e.target.value))}
              className="flex-1 rounded border border-gray-200 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-24 text-gray-500">{t('budget.limitTokens')}</span>
            <input
              data-testid="budget-limit-tokens"
              type="number"
              min={0}
              step="100"
              value={draftTokens}
              onChange={(e) => setDraftTokens(Number(e.target.value))}
              className="flex-1 rounded border border-gray-200 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-24 text-gray-500">{t('budget.enforcement')}</span>
            <select
              data-testid="budget-enforcement"
              value={draftEnforcement}
              onChange={(e) => setDraftEnforcement(e.target.value as 'hard_stop' | 'notify')}
              className="flex-1 rounded border border-gray-200 px-2 py-1"
            >
              <option value="hard_stop">{t('budget.hardStop')}</option>
              <option value="notify">{t('budget.notify')}</option>
            </select>
          </label>
        </div>
      )}
      {budget.exhausted && (
        <div data-testid="budget-exhausted" className="mt-2 text-xs text-red-700">
          {t('budget.exhausted')}
        </div>
      )}
    </div>
  );
}
