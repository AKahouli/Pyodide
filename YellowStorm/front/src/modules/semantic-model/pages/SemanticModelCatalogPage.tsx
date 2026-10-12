import { useDeferredValue, useState } from 'react';
import { AlertCircle, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useModuleTranslation } from '@/modules/localization';
import { CreateSemanticModelDialog } from '../components/catalog/CreateSemanticModelDialog';
import { SemanticModelRow } from '../components/catalog/SemanticModelRow';
import { useSemanticModels } from '../query/hooks';

export function SemanticModelCatalogPage() {
  const { t } = useModuleTranslation('semantic-model');
  const navigate = useNavigate();
  const [search,setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [scope, setScope] = useState('all');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const [content, setContent] = useState('all');
  const [createOpen,setCreateOpen] = useState(false);
  const filters: Record<string,string|number|undefined> = {
    search: deferredSearch || undefined,
    kind: kind === 'all' ? undefined : kind,
    status: status === 'active' ? undefined : status,
    scope: scope === 'shared' ? 'shared' : undefined,
  };
  const query = useSemanticModels(filters);
  const items = (query.data?.items ?? [])
    .filter((model) => status === 'archived' || model.status !== 'archived')
    .filter((model) => content !== 'records' || Boolean(model.recordCount))
    .filter((model) => content !== 'attention' || Boolean(model.brokenBindingCount));
  const hasActiveFilters = Boolean(search.trim()) || scope !== 'all' || kind !== 'all' || status !== 'active' || content !== 'all';
  const clearFilters = () => {
    setSearch('');
    setScope('all');
    setKind('all');
    setStatus('active');
    setContent('all');
  };

  return <div className='min-h-full min-w-0 max-w-full overflow-x-hidden px-4 pb-28 pt-6 sm:px-8'>
    <div className='mx-auto max-w-7xl space-y-6'>
      <header className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
        <div className='max-w-2xl space-y-2'><h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>{t('catalog.title')}</h1><p className='text-sm leading-6 text-muted-foreground'>{t('catalog.description')}</p></div>
        <Button className='self-start shrink-0' onClick={() => setCreateOpen(true)}><Plus className='mr-2 h-4 w-4' />{t('catalog.create')}</Button>
      </header>
      <section className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <Tabs value={scope} onValueChange={setScope}><TabsList>{(['all','shared'] as const).map((item) => <TabsTrigger key={item} value={item}>{t(`catalog.section.${item}`)}</TabsTrigger>)}</TabsList></Tabs>
          <div className='relative w-full sm:w-72'><Search aria-hidden className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' /><Input className='pl-9' value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('catalog.search')} aria-label={t('catalog.search')} /></div>
        </div>
        <div className='flex flex-wrap items-end gap-3'>
          <CatalogFilter label={t('catalog.filter.kind')} value={kind} onChange={setKind} options={[
            ['all', t('catalog.filter.allKinds')], ['designed', t('catalog.badge.designed')], ['workspace_default', t('catalog.badge.automatic')],
          ]} />
          <CatalogFilter label={t('catalog.filter.status')} value={status} onChange={setStatus} options={[
            ['active', t('catalog.filter.active')], ['draft', t('status.draft')], ['published', t('status.published')], ['archived', t('status.archived')],
          ]} />
          <CatalogFilter label={t('catalog.filter.content')} value={content} onChange={setContent} options={[
            ['all', t('catalog.filter.anyContent')], ['records', t('catalog.section.records')], ['attention', t('catalog.section.attention')],
          ]} />
          {hasActiveFilters && <Button variant='ghost' size='sm' onClick={clearFilters}><X aria-hidden className='mr-1.5 h-4 w-4' />{t('catalog.clearFilters')}</Button>}
        </div>
        {!query.isLoading && !query.isError && <p className='text-xs text-muted-foreground' role='status'>{t('catalog.modelCount', { count: items.length })}</p>}
        {query.isLoading ? (
          <div className='space-y-2' role='status' aria-label={t('catalog.loading')}>
            {Array.from({length:6},(_,index) => <Skeleton key={index} className='h-24 rounded-md' />)}
          </div>
        ) : query.isError ? (
          <div className='flex min-h-80 flex-col items-center justify-center rounded-2xl border bg-background p-8 text-center' role='alert'>
            <AlertCircle className='h-8 w-8 text-destructive' />
            <h2 className='mt-4 text-lg font-semibold'>{t('catalog.errorTitle')}</h2>
            <p className='mt-1 max-w-md text-sm leading-6 text-muted-foreground'>{t('catalog.errorDescription')}</p>
            <Button className='mt-5' variant='outline' disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RefreshCw className='mr-2 h-4 w-4' />
              {query.isFetching ? t('catalog.retrying') : t('action.retry')}
            </Button>
          </div>
        ) : items.length ? (
          <div className='overflow-hidden rounded-lg border bg-card'>
            <Table className='table-fixed' aria-label={t('catalog.title')}>
              <TableHeader className='bg-muted/40'><TableRow>
                <TableHead scope='col' className='px-4'>{t('catalog.column.model')}</TableHead>
                <TableHead scope='col' className='hidden w-28 sm:table-cell'>{t('catalog.filter.status')}</TableHead>
                <TableHead scope='col' className='hidden w-44 xl:table-cell'>{t('catalog.column.knowledge')}</TableHead>
                <TableHead scope='col' className='hidden w-24 text-right sm:table-cell' title={t('catalog.recordsHint')}>{t('catalog.column.records')}</TableHead>
                <TableHead scope='col' className='w-24 pr-4 text-right'><span className='sr-only'>{t('catalog.column.actions')}</span></TableHead>
              </TableRow></TableHeader>
              <TableBody>{items.map((model) => <SemanticModelRow key={model.id} model={model} />)}</TableBody>
            </Table>
          </div>
        ) : (
          <div className='flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center'>
            <div className='mb-4 rounded-2xl bg-primary/10 p-4 text-primary'><Sparkles className='h-7 w-7' /></div>
            <h2 className='text-lg font-semibold'>{t(hasActiveFilters ? 'catalog.filteredEmptyTitle' : 'catalog.emptyTitle')}</h2>
            <p className='mt-1 max-w-md text-sm leading-6 text-muted-foreground'>{t(hasActiveFilters ? 'catalog.filteredEmptyDescription' : 'catalog.emptyDescription')}</p>
            {!hasActiveFilters && (
              <Button className='mt-5' onClick={() => setCreateOpen(true)}>{t('catalog.create')}</Button>
            )}
          </div>
        )}
      </section>
    </div>
    <CreateSemanticModelDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate(`/semantic-models/${id}`)} />
  </div>;
}

function CatalogFilter({ label, value, onChange, options }: Readonly<{ label: string; value: string; onChange: (value: string) => void; options: string[][] }>) {
  return <label className='flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-muted-foreground sm:flex-none'>
    {label}
    <select className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:w-40' value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select>
  </label>;
}
