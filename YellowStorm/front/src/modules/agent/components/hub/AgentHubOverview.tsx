import { Bot, Lock, Users, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { usePersonalAgents, useDefaultAgents, useSharedAgents } from '../../store';
import { useModuleTranslation } from '@/modules/localization';
import type { OwnershipFilter } from '../../hooks/useAgentHubFilters';

interface AgentHubOverviewProps {
  activeOwner: OwnershipFilter;
  onSelectOwner: (owner: OwnershipFilter) => void;
}

interface Tile {
  key: string;
  label: string;
  count: number;
  icon: LucideIcon;
  owner: OwnershipFilter;
  accent: string;
}

export function AgentHubOverview({ activeOwner, onSelectOwner }: AgentHubOverviewProps) {
  const personal = usePersonalAgents();
  const defaults = useDefaultAgents();
  const shared = useSharedAgents();
  const { t } = useModuleTranslation('agent');

  const tiles: Tile[] = [
    {
      key: 'personal',
      label: t('hub.overview.personal'),
      count: personal.length,
      icon: Bot,
      owner: 'mine',
      accent: 'var(--chart-1)',
    },
    {
      key: 'defaults',
      label: t('hub.overview.defaults'),
      count: defaults.length,
      icon: Lock,
      owner: 'default',
      accent: 'var(--chart-3)',
    },
    {
      key: 'shared',
      label: t('hub.overview.shared'),
      count: shared.length,
      icon: Users,
      owner: 'shared',
      accent: 'var(--chart-2)',
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t('hub.overview.eyebrow')}
        </span>
        <span className="h-px flex-1 bg-border/60" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          const active = activeOwner === tile.owner;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => onSelectOwner(active ? 'all' : tile.owner)}
              className={cn(
                'group relative overflow-hidden rounded-xl border border-border/60 bg-card px-5 py-4 text-left transition',
                'hover:border-border hover:shadow-sm',
                active && 'border-foreground/20 shadow-sm',
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-0 h-full w-0.5 transition-opacity',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70',
                )}
                style={{ backgroundColor: tile.accent }}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {tile.label}
                  </span>
                  <span className="mt-2 text-4xl font-semibold leading-none tracking-tight tabular-nums">
                    {tile.count}
                  </span>
                </div>
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground transition',
                    active && 'border-foreground/20 text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
