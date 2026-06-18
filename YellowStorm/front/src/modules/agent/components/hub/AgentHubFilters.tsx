import { LayoutGrid, List, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAgentTypes } from '../../store';
import { useModuleTranslation } from '@/modules/localization';
import type {
  OwnershipFilter,
  SortKey,
  ViewMode,
} from '../../hooks/useAgentHubFilters';

const ALL_TYPE_VALUE = '__all__';

interface AgentHubFiltersProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
  owner: OwnershipFilter;
  onOwnerChange: (value: OwnershipFilter) => void;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  view: ViewMode;
  onViewChange: (value: ViewMode) => void;
  hasActiveFilters: boolean;
  onClearAll: () => void;
}

export function AgentHubFilters({
  searchInput,
  onSearchChange,
  type,
  onTypeChange,
  owner,
  onOwnerChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  hasActiveFilters,
  onClearAll,
}: AgentHubFiltersProps) {
  const agentTypes = useAgentTypes();
  const { t } = useModuleTranslation('agent');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('hub.filters.searchPlaceholder')}
          className="border-transparent bg-transparent pl-9 pr-8 shadow-none focus-visible:border-border focus-visible:bg-background"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="h-5 w-px bg-border/60" />

      <Select
        value={type || ALL_TYPE_VALUE}
        onValueChange={(v) => onTypeChange(v === ALL_TYPE_VALUE ? '' : v)}
      >
        <SelectTrigger className="h-9 w-[160px] border-transparent bg-transparent shadow-none hover:bg-accent/50">
          <SelectValue placeholder={t('hub.filters.type')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TYPE_VALUE}>{t('hub.filters.typeAll')}</SelectItem>
          {agentTypes.map((agentType) => (
            <SelectItem key={agentType.id} value={agentType.id}>
              {agentType.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={owner} onValueChange={(v) => onOwnerChange(v as OwnershipFilter)}>
        <SelectTrigger className="h-9 w-[150px] border-transparent bg-transparent shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('hub.filters.ownerAll')}</SelectItem>
          <SelectItem value="mine">{t('hub.filters.ownerMine')}</SelectItem>
          <SelectItem value="default">{t('hub.filters.ownerDefault')}</SelectItem>
          <SelectItem value="shared">{t('hub.filters.ownerShared')}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={(v) => onSortChange(v as SortKey)}>
        <SelectTrigger className="h-9 w-[180px] border-transparent bg-transparent shadow-none hover:bg-accent/50">
          <span className="text-muted-foreground">{t('hub.sort.label')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated">{t('hub.sort.updated')}</SelectItem>
          <SelectItem value="created">{t('hub.sort.created')}</SelectItem>
          <SelectItem value="name">{t('hub.sort.name')}</SelectItem>
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-2">
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="gap-1 text-xs text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t('hub.filters.clear')}
          </Button>
        )}

        <div className="flex items-center rounded-md border border-border/60 bg-background p-0.5">
          <button
            type="button"
            onClick={() => onViewChange('grid')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition',
              view === 'grid' && 'bg-accent text-foreground',
              view !== 'grid' && 'hover:text-foreground',
            )}
            title={t('hub.view.grid')}
            aria-label={t('hub.view.grid')}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewChange('list')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition',
              view === 'list' && 'bg-accent text-foreground',
              view !== 'list' && 'hover:text-foreground',
            )}
            title={t('hub.view.list')}
            aria-label={t('hub.view.list')}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
