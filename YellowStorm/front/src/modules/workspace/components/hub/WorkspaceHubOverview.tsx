import { Globe, Layers, User, Users, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { OwnershipFilter } from '../../hooks/useWorkspaceHubFilters';
import { useModuleTranslation } from '@/modules/localization';

interface WorkspaceHubOverviewProps {
  counts: { personal: number; mine: number; shared: number; public: number };
  activeOwner: OwnershipFilter;
  onSelectOwner: (owner: OwnershipFilter) => void;
}

interface OwnershipOption {
  key: string;
  label: string;
  count: number;
  icon: LucideIcon;
  owner: Exclude<OwnershipFilter, 'all'>;
}

export function WorkspaceHubOverview({
  counts,
  activeOwner,
  onSelectOwner,
}: Readonly<WorkspaceHubOverviewProps>) {
  const { t } = useModuleTranslation('workspace');
  const options: OwnershipOption[] = [
    {
      key: 'personal',
      label: t('hub.owner.personal'),
      count: counts.personal,
      icon: User,
      owner: 'personal',
    },
    {
      key: 'mine',
      label: t('hub.owner.mine'),
      count: counts.mine,
      icon: Layers,
      owner: 'mine',
    },
    {
      key: 'shared',
      label: t('hub.owner.shared'),
      count: counts.shared,
      icon: Users,
      owner: 'shared',
    },
    {
      key: 'public',
      label: t('hub.owner.public'),
      count: counts.public,
      icon: Globe,
      owner: 'public',
    },
  ];

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('hub.owner.ariaLabel')}>
        {options.map((option) => {
          const Icon = option.icon;
          const active = activeOwner === option.owner;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onSelectOwner(active ? 'all' : option.owner)}
              aria-pressed={active}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border/70 bg-card px-3 text-sm font-medium transition-colors',
                'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active && 'border-primary/40 bg-primary/10 text-foreground',
              )}
            >
              <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <span>{option.label}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {option.count}
              </span>
            </button>
          );
        })}
    </div>
  );
}
