import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleTranslation } from '@/modules/localization';
import { useStreams } from '../../query/hooks';

// Client-derivable groupings (no aggregate endpoint exists).
const ACTIVE = new Set(['active', 'planning', 'partially_blocked', 'start_requested']);
const ATTENTION = new Set(['waiting_for_owner', 'waiting_for_human', 'waiting_for_budget_decision']);

/**
 * Desktop streams landing. KPIs are limited to what's derivable from the
 * already-loaded stream list. FLAG: "agents working" and cross-stream
 * "tasks done today" are intentionally omitted — no aggregate endpoint exists.
 */
export function StreamsDashboard(): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const navigate = useNavigate();
  const { data: streams = [] } = useStreams();

  const active = streams.filter((s) => ACTIVE.has(s.status)).length;
  const attention = streams.filter((s) => ATTENTION.has(s.status)).length;
  const kpis = [
    { key: 'active', label: t('dashboard.kpi.active'), value: active },
    { key: 'total', label: t('dashboard.kpi.total'), value: streams.length },
    { key: 'attention', label: t('dashboard.kpi.attention'), value: attention },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h1>

      <div className="grid grid-cols-3 gap-4">
        {kpis.map((k) => (
          <div key={k.key} data-testid={`kpi-${k.key}`} className="rounded-2xl border border-border bg-card p-5">
            <div className="text-sm text-muted-foreground">{k.label}</div>
            <div className="mt-2 text-3xl font-bold text-foreground">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {streams.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => navigate(`/worky/${s.id}`)}
            className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-worky-working" />
              <span className="truncate font-semibold text-foreground">{s.title}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {t('header.planVersion', { version: s.currentPlanVersion })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
