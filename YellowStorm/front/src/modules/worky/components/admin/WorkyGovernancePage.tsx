import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useModuleTranslation } from '@/modules/localization';
import {
  useGovernancePolicy,
  useUpdateGovernancePolicy,
} from '../../query/hooks';
import type { WorkyGovernanceLevel, WorkyGovernancePolicy } from '../../types';

const KNOWN_CATEGORIES = [
  'internal_analysis',
  'research',
  'drafting',
  'internal_artifact_write',
  'internal_platform_notification',
  'external_send',
  'customer_facing_release',
  'external_comms',
  'budget_overrun',
  'cancel_human_task',
  'replanning',
];

const LEVELS: WorkyGovernanceLevel[] = ['off', 'notify', 'approval', 'hard_block'];

const buildDefaultPolicy = (workspaceId: string): WorkyGovernancePolicy => ({
  workspaceId,
  scope: 'workspace',
  defaultLevel: 'off',
  categories: KNOWN_CATEGORIES.map((category) => ({ category, level: 'off' })),
  allowStreamOwnerOverride: true,
  maxOwnerRelaxLevel: 'notify',
});

/**
 * Admin-only governance policy editor. Per canonical §5.3:
 *   - per-category level (off / notify / approval / hard_block)
 *   - `allowStreamOwnerOverride` toggle
 *   - `maxOwnerRelaxLevel` ceiling (the LLM cannot self-lower below
 *     this; the owner override cannot reach `off`).
 *
 * The page is wired under `/admin/worky-governance` and reads
 * `?workspaceId=...` from the query string. If the param is
 * missing the page shows an inline input so an admin can paste
 * the workspace id — the canonical plan does not require a
 * workspace-picker UI in Part 3.
 */
export function WorkyGovernancePage(): JSX.Element {
  const { t: tWorky } = useModuleTranslation('worky');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryWorkspaceId = searchParams.get('workspaceId') ?? '';
  const [workspaceInput, setWorkspaceInput] = useState('');

  const workspaceId = queryWorkspaceId || workspaceInput;

  const policyQuery = useGovernancePolicy(workspaceId || null);
  const update = useUpdateGovernancePolicy();
  const [draft, setDraft] = useState<WorkyGovernancePolicy>(
    buildDefaultPolicy(workspaceId),
  );

  useEffect(() => {
    if (policyQuery.data) setDraft(policyQuery.data);
  }, [policyQuery.data]);

  const handleCategoryChange = (category: string, level: WorkyGovernanceLevel) => {
    setDraft((current) => ({
      ...current,
      categories: current.categories.map((c) =>
        c.category === category ? { ...c, level } : c,
      ),
    }));
  };

  const handleSubmit = async () => {
    await update.mutateAsync(draft);
  };

  if (!workspaceId) {
    return (
      <div className='mx-auto w-full max-w-md p-6'>
        <h1 className='mb-1 text-xl font-semibold'>{tWorky('governance.title')}</h1>
        <p className='mb-4 text-sm text-muted-foreground'>{tWorky('governance.subtitle')}</p>
        <label className='mb-2 block text-xs font-medium text-muted-foreground'>
          Workspace id
          <input
            value={workspaceInput}
            onChange={(e) => setWorkspaceInput(e.target.value)}
            placeholder='workspace_xxx'
            className='mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
          />
        </label>
        <button
          type='button'
          className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50'
          disabled={!workspaceInput}
          onClick={() => setSearchParams({ workspaceId: workspaceInput })}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className='mx-auto w-full max-w-3xl p-6'>
      <h1 className='mb-1 text-xl font-semibold'>{tWorky('governance.title')}</h1>
      <p className='mb-6 text-sm text-muted-foreground'>{tWorky('governance.subtitle')}</p>

      {policyQuery.isLoading ? (
        <p className='text-sm text-muted-foreground'>{tWorky('governance.loading')}</p>
      ) : null}

      {policyQuery.error ? (
        <p className='mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700'>
          {tWorky('governance.noPolicyYet')}
        </p>
      ) : null}

      <section className='mb-6 rounded-md border border-border bg-card p-4'>
        <h2 className='mb-2 text-sm font-semibold'>{tWorky('governance.defaultLevel')}</h2>
        <div className='flex flex-wrap gap-2'>
          {LEVELS.map((level) => (
            <button
              key={level}
              type='button'
              className={
                'rounded-md border px-3 py-1 text-xs ' +
                (draft.defaultLevel === level
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background')
              }
              onClick={() => setDraft({ ...draft, defaultLevel: level })}
            >
              {level}
            </button>
          ))}
        </div>
      </section>

      <section className='mb-6 rounded-md border border-border bg-card p-4'>
        <h2 className='mb-2 text-sm font-semibold'>{tWorky('governance.categories')}</h2>
        <ul className='divide-y divide-border/60'>
          {draft.categories.map((c) => (
            <li key={c.category} className='flex items-center justify-between gap-2 py-2'>
              <span className='text-xs font-medium'>{c.category}</span>
              <div className='flex flex-wrap gap-1'>
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    type='button'
                    className={
                      'rounded-md border px-2 py-0.5 text-xs ' +
                      (c.level === level
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background')
                    }
                    onClick={() => handleCategoryChange(c.category, level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className='mb-6 rounded-md border border-border bg-card p-4'>
        <h2 className='mb-2 text-sm font-semibold'>{tWorky('governance.ownerOverride')}</h2>
        <label className='mb-3 flex items-center gap-2 text-xs'>
          <input
            type='checkbox'
            checked={draft.allowStreamOwnerOverride}
            onChange={(e) =>
              setDraft({ ...draft, allowStreamOwnerOverride: e.target.checked })
            }
          />
          {tWorky('governance.allowOverride')}
        </label>
        <div className='flex flex-wrap gap-2'>
          {LEVELS.map((level) => (
            <button
              key={level}
              type='button'
              className={
                'rounded-md border px-3 py-1 text-xs ' +
                (draft.maxOwnerRelaxLevel === level
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background')
              }
              onClick={() => setDraft({ ...draft, maxOwnerRelaxLevel: level })}
            >
              {tWorky('governance.relaxCeiling', { level })}
            </button>
          ))}
        </div>
      </section>

      <button
        type='button'
        className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50'
        onClick={handleSubmit}
        disabled={update.isPending}
        data-testid='governance-save'
      >
        {tWorky('governance.save')}
      </button>
      {update.isSuccess ? (
        <p className='mt-3 text-xs text-muted-foreground'>{tWorky('governance.saved')}</p>
      ) : null}
    </div>
  );
}
