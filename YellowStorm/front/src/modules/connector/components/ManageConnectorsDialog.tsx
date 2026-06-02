import { useMemo, useState } from 'react';
import { Loader2, Plug, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import type { ConnectorOption } from '@/modules/agent/api';
import { ConnectorLogo } from './ConnectorLogo';
import { useConnectorConnections } from '../useConnectorConnections';

const SYSTEM_CATEGORY_NAME = 'system';
const ALL_CATEGORIES = '__all__';
const UNCATEGORIZED = '__uncategorized__';

interface ManageConnectorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectors: ConnectorOption[];
  loading?: boolean;
  /** Invoked when the user picks a connected connector to use in the conversation. */
  onUseConnector?: (connector: ConnectorOption) => void;
}

interface ConnectorGroup {
  key: string;
  name: string;
  items: ConnectorOption[];
}

/** Full connector management modal: connectors grouped by category, 2 per row, System excluded. */
export function ManageConnectorsDialog({ open, onOpenChange, connectors, loading, onUseConnector }: ManageConnectorsDialogProps) {
  const { t } = useModuleTranslation('common');
  const { getStatus, connect } = useConnectorConnections();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  // Everything except System connectors — the pool the modal manages.
  const available = useMemo(
    () => connectors.filter((c) => (c.categoryName ?? '').toLowerCase() !== SYSTEM_CATEGORY_NAME),
    [connectors],
  );

  // Distinct category names present (sorted), for the filter dropdown.
  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const c of available) {
      if (c.categoryName) names.add(c.categoryName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [available]);

  const hasUncategorized = useMemo(() => available.some((c) => !c.categoryName), [available]);

  // Apply search + category filter, then group by category (categorized first, uncategorized last).
  const groups = useMemo<ConnectorGroup[]>(() => {
    const query = search.trim().toLowerCase();
    const matching = available.filter((c) => {
      const matchesCategory =
        categoryFilter === ALL_CATEGORIES ||
        (categoryFilter === UNCATEGORIZED ? !c.categoryName : c.categoryName === categoryFilter);
      const matchesSearch =
        !query ||
        c.name.toLowerCase().includes(query) ||
        (c.description ?? '').toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    const byCategory = new Map<string, ConnectorOption[]>();
    for (const c of matching) {
      const key = c.categoryName || UNCATEGORIZED;
      const list = byCategory.get(key) ?? [];
      list.push(c);
      byCategory.set(key, list);
    }

    const result: ConnectorGroup[] = [];
    for (const name of categories) {
      const items = byCategory.get(name);
      if (items && items.length > 0) result.push({ key: name, name, items });
    }
    const uncategorized = byCategory.get(UNCATEGORIZED);
    if (uncategorized && uncategorized.length > 0) {
      result.push({ key: UNCATEGORIZED, name: t('connectors.uncategorized') || 'Uncategorized', items: uncategorized });
    }
    return result;
  }, [available, categories, categoryFilter, search, t]);

  const isEmpty = groups.length === 0;
  const isFiltered = Boolean(search) || categoryFilter !== ALL_CATEGORIES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('connectors.manageTitle') || 'Manage connectors'}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='relative w-full sm:flex-1'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              placeholder={t('connectors.searchPlaceholder') || 'Search connectors'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-9'
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className='w-full sm:w-[200px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>{t('connectors.allCategories') || 'All categories'}</SelectItem>
              {categories.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
              {hasUncategorized && (
                <SelectItem value={UNCATEGORIZED}>{t('connectors.uncategorized') || 'Uncategorized'}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className='py-1'>
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='size-6 animate-spin text-muted-foreground' />
            </div>
          ) : isEmpty ? (
            <div className='py-12 text-center text-sm text-muted-foreground'>
              {isFiltered
                ? t('connectors.noMatch') || 'No connectors match your filters'
                : t('input.noConnectors') || 'No connectors available'}
            </div>
          ) : (
            <ScrollArea className='h-[440px] pr-3'>
              <div className='space-y-6'>
                {groups.map((group) => (
                  <section key={group.key} className='space-y-2'>
                    <div className='flex items-center gap-3'>
                      <h3 className='text-sm font-semibold text-muted-foreground'>{group.name}</h3>
                      <div className='h-px flex-1 bg-border' />
                      <span className='text-xs text-muted-foreground'>{group.items.length}</span>
                    </div>
                    <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                      {group.items.map((connector) => {
                        const status = getStatus(connector);
                        return (
                          <div key={connector.id} className='flex items-center gap-3 rounded-lg border p-3'>
                            <ConnectorLogo connector={connector} size={40} />
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-2'>
                                <span className='truncate text-sm font-medium'>{connector.name}</span>
                                {status.requiresAuth && status.connected && (
                                  <span
                                    className='size-2.5 shrink-0 rounded-full bg-green-500'
                                    title={t('connectors.connected') || 'Connected'}
                                    aria-label={t('connectors.connected') || 'Connected'}
                                  />
                                )}
                              </div>
                              {connector.description && (
                                <p className='truncate text-xs text-muted-foreground'>{connector.description}</p>
                              )}
                            </div>
                            <div className='shrink-0'>
                              {!status.requiresAuth || status.connected ? (
                                onUseConnector ? (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() => {
                                      onUseConnector(connector);
                                      onOpenChange(false);
                                    }}
                                  >
                                    {t('connectors.use') || 'Use'}
                                  </Button>
                                ) : null
                              ) : (
                                <Button size='sm' onClick={() => void connect(connector)} disabled={status.connecting}>
                                  {status.connecting ? (
                                    <Loader2 className='mr-1.5 size-4 animate-spin' />
                                  ) : (
                                    <Plug className='mr-1.5 size-4' />
                                  )}
                                  {t('connectors.connect') || 'Connect'}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
