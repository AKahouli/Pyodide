import { useDeferredValue, useState } from 'react';
import { Plus, Search, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useModuleTranslation } from '@/modules/localization';
import { CreateSemanticModelDialog } from '../components/catalog/CreateSemanticModelDialog';
import { SemanticModelCard } from '../components/catalog/SemanticModelCard';
import { useSemanticModels } from '../query/hooks';

type CatalogSection = 'all' | 'designed' | 'automatic' | 'records' | 'attention' | 'archived';

export function SemanticModelCatalogPage() {
  const { t } = useModuleTranslation('semantic-model');
  const navigate = useNavigate();
  const [search,setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [section,setSection] = useState<CatalogSection>('all');
  const [createOpen,setCreateOpen] = useState(false);
  const filters: Record<string,string|number|undefined> = {
    search: deferredSearch || undefined,
    kind: section === 'designed' ? 'designed' : section === 'automatic' ? 'workspace_default' : undefined,
    status: section === 'archived' ? 'archived' : undefined,
  };
  const query = useSemanticModels(filters);
  const items = (query.data?.items ?? []).filter((model) => section === 'archived' || model.status !== 'archived').filter((model) => section !== 'records' || Boolean(model.recordCount)).filter((model) => section !== 'attention' || Boolean(model.brokenBindingCount));
  return <main className='min-h-full min-w-0 max-w-full overflow-x-hidden bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.08),transparent_38%)] px-5 py-8 sm:px-10'>
    <div className='mx-auto max-w-7xl space-y-8'>
      <header className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
        <div className='max-w-2xl space-y-2'><div className='flex items-center gap-2 text-sm font-medium text-primary'><Sparkles className='h-4 w-4' />{t('catalog.eyebrow')}</div><h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>{t('catalog.title')}</h1><p className='text-muted-foreground'>{t('catalog.description')}</p></div>
        <Button size='lg' onClick={() => setCreateOpen(true)}><Plus className='mr-2 h-4 w-4' />{t('catalog.create')}</Button>
      </header>
      <section className='space-y-4'>
        <div className='flex flex-col gap-3 rounded-2xl border bg-background/85 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center'>
          <div className='relative min-w-64 flex-1'><Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' /><Input className='pl-9' value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('catalog.search')} aria-label={t('catalog.search')} /></div>
          <Tabs value={section} onValueChange={(value) => setSection(value as CatalogSection)} className='min-w-0 max-w-full overflow-x-auto'><TabsList className='w-max'>{(['all','designed','automatic','records','attention','archived'] as const).map((item) => <TabsTrigger key={item} value={item}>{t(`catalog.section.${item}`)}</TabsTrigger>)}</TabsList></Tabs>
        </div>
        {query.isLoading ? <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-3'>{Array.from({length:6},(_,index) => <Skeleton key={index} className='h-72 rounded-2xl' />)}</div> : items.length ? <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-3'>{items.map((model) => <SemanticModelCard key={model.id} model={model} />)}</div> : <div className='flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed bg-muted/20 p-8 text-center'><div className='mb-4 rounded-2xl bg-primary/10 p-4 text-primary'><Sparkles className='h-7 w-7' /></div><h2 className='text-lg font-semibold'>{t('catalog.emptyTitle')}</h2><p className='mt-1 max-w-md text-sm text-muted-foreground'>{t('catalog.emptyDescription')}</p><Button className='mt-5' onClick={() => setCreateOpen(true)}>{t('catalog.create')}</Button></div>}
      </section>
    </div>
    <CreateSemanticModelDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate(`/semantic-models/${id}`)} />
  </main>;
}
