import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStreams, useCreateStream } from '../query/hooks';
import { useModuleTranslation } from '@/modules/localization';
import {
  WORKY_STREAM_TITLE_MAX,
  WORKY_STREAM_TITLE_MIN,
} from '../constants';

function StatusDot({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'active' || status === 'planning'
      ? 'bg-emerald-500'
      : status === 'paused' || status === 'start_validation_failed'
        ? 'bg-amber-500'
        : status === 'completed' || status === 'archived'
          ? 'bg-neutral-500'
          : 'bg-sky-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden />;
}

export function StreamSidebar(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('worky');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const { data: streams = [], isLoading } = useStreams({ search: search || undefined });
  const createStream = useCreateStream();

  const onCreate = async (): Promise<void> => {
    const title = draftTitle.trim();
    if (title.length < WORKY_STREAM_TITLE_MIN || title.length > WORKY_STREAM_TITLE_MAX) return;
    const stream = await createStream.mutateAsync({ title });
    setDraftTitle('');
    setCreateOpen(false);
    navigate(`/worky/${stream.id}`);
  };

  return (
    <aside className='flex h-full w-72 flex-col border-r border-border/60 bg-background/40'>
      <div className='flex items-center justify-between gap-2 border-b border-border/60 px-3 py-3'>
        <div className='flex flex-col'>
          <span className='text-sm font-semibold'>{t('sidebar.title')}</span>
          <span className='text-xs text-muted-foreground'>{t('sidebar.subtitle')}</span>
        </div>
        <Button
          size='sm'
          onClick={() => setCreateOpen((open) => !open)}
          aria-label={t('sidebar.newStream')}
        >
          <Plus className='h-4 w-4' />
        </Button>
      </div>

      <div className='px-3 py-2'>
        <div className='relative'>
          <Search className='pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            className='h-8 pl-7 text-xs'
          />
        </div>
      </div>

      {createOpen ? (
        <div className='space-y-2 border-b border-border/60 bg-muted/30 px-3 py-3'>
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder={t('sidebar.newStreamPlaceholder')}
            maxLength={WORKY_STREAM_TITLE_MAX}
            disabled={createStream.isPending}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void onCreate();
              }
              if (event.key === 'Escape') {
                setCreateOpen(false);
                setDraftTitle('');
              }
            }}
            autoFocus
          />
          <div className='flex justify-end gap-2'>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                setCreateOpen(false);
                setDraftTitle('');
              }}
              disabled={createStream.isPending}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              size='sm'
              onClick={() => void onCreate()}
              disabled={
                createStream.isPending ||
                draftTitle.trim().length < WORKY_STREAM_TITLE_MIN ||
                draftTitle.trim().length > WORKY_STREAM_TITLE_MAX
              }
            >
              {createStream.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : t('actions.create')}
            </Button>
          </div>
        </div>
      ) : null}

      <ScrollArea className='flex-1'>
        <ul className='flex flex-col gap-0.5 p-2'>
          {isLoading ? (
            <li className='px-2 py-2 text-xs text-muted-foreground'>{t('sidebar.loading')}</li>
          ) : streams.length === 0 ? (
            <li className='px-2 py-2 text-xs text-muted-foreground'>{t('sidebar.empty')}</li>
          ) : (
            streams.map((stream) => (
              <li key={stream.id}>
                <button
                  type='button'
                  className='flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/60'
                  onClick={() => navigate(`/worky/${stream.id}`)}
                >
                  <StatusDot status={stream.status} />
                  <span className='flex-1 truncate'>{stream.title}</span>
                  <span className='text-[10px] uppercase tracking-wide text-muted-foreground'>
                    {stream.status}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
    </aside>
  );
}
