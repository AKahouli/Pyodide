import { Loader2, Search, StopCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { SearchIndexProgress } from './SearchIndexProgress';

/**
 * The side panel of a search index build that no data update is attached to (an index asked for on
 * its own, or a run that was closed long ago): its progress, and Stop while it builds.
 */
export function SearchIndexPanel({ modelId, building, onClose, onStop, stopping = false, stoppingSlow = false }: Readonly<{
  modelId: string;
  building: boolean;
  onClose: () => void;
  /** Stop the build; absent when the person cannot stop it. */
  onStop?: () => void;
  stopping?: boolean;
  /** The stop has been pending for long: its worker may no longer answer. */
  stoppingSlow?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  return <aside className='relative z-20 flex h-full w-full max-w-sm shrink-0 flex-col border-l bg-background shadow-xl' aria-label={t('runStatus.indexTitle')}>
    <header className='flex items-start gap-3 border-b px-4 py-3'>
      {building ? <Loader2 className='mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary' /> : <Search className='mt-0.5 h-5 w-5 shrink-0 text-muted-foreground' />}
      <div className='min-w-0 flex-1'>
        <h2 className='font-semibold'>{t('runStatus.indexTitle')}</h2>
        <p className='mt-1 text-xs text-muted-foreground'>{stopping ? t(stoppingSlow ? 'runStatus.stoppingSlowHint' : 'runStatus.indexStoppingHint') : t('runStatus.indexHint')}</p>
      </div>
      <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={onClose} aria-label={t('action.close')}>
        <X className='h-4 w-4' />
      </Button>
    </header>
    <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-3 pb-28'>
      {building && onStop && <Button variant='outline' size='sm' className='w-full' disabled={stopping} onClick={onStop}>
        {stopping ? <Loader2 className='mr-1.5 h-4 w-4 animate-spin' /> : <StopCircle className='mr-1.5 h-4 w-4' />}
        {stopping ? t('runStop.stopping') : t('runStop.stop')}
      </Button>}
      <SearchIndexProgress modelId={modelId} />
    </div>
  </aside>;
}
