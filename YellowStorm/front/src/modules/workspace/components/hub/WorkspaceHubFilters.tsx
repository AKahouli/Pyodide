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
import type {
  OwnershipFilter,
  SortKey,
  ViewMode,
} from '../../hooks/useWorkspaceHubFilters';

interface WorkspaceHubFiltersProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  owner: OwnershipFilter;
  onOwnerChange: (value: OwnershipFilter) => void;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  view: ViewMode;
  onViewChange: (value: ViewMode) => void;
  hasActiveFilters: boolean;
  onClearAll: () => void;
}

export function WorkspaceHubFilters({
  searchInput,
  onSearchChange,
  owner,
  onOwnerChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  hasActiveFilters,
  onClearAll,
}: Readonly<WorkspaceHubFiltersProps>) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Rechercher un workspace…"
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

      <Select value={owner} onValueChange={(v) => onOwnerChange(v as OwnershipFilter)}>
        <SelectTrigger className="h-9 w-[160px] border-transparent bg-transparent shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous</SelectItem>
          <SelectItem value="personal">Personnel</SelectItem>
          <SelectItem value="mine">Mes workspaces</SelectItem>
          <SelectItem value="shared">Partagés avec moi</SelectItem>
          <SelectItem value="public">Publics</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={(v) => onSortChange(v as SortKey)}>
        <SelectTrigger className="h-9 w-[190px] border-transparent bg-transparent shadow-none hover:bg-accent/50">
          <span className="text-muted-foreground">Trier&nbsp;:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated">Récemment modifiés</SelectItem>
          <SelectItem value="created">Récemment créés</SelectItem>
          <SelectItem value="name">Nom (A→Z)</SelectItem>
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
            Effacer
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
            title="Vue grille"
            aria-label="Vue grille"
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
            title="Vue liste"
            aria-label="Vue liste"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
