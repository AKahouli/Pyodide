import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useCreateStream, useDeleteStream, useStreams } from '../../query/hooks';
import { WORKY_STREAM_TITLE_MAX, WORKY_STREAM_TITLE_MIN } from '../../constants';

// Client-derivable groupings (no aggregate endpoint exists).
const ACTIVE = new Set(['active', 'planning', 'partially_blocked', 'start_requested']);
const ATTENTION = new Set(['waiting_for_owner', 'waiting_for_human', 'waiting_for_budget_decision']);

/**
 * Worky landing page: the single entry point for finding, creating and deleting
 * streams now that the sidebar is gone. KPIs are limited to what's derivable
 * from the already-loaded stream list. FLAG: "agents working" and cross-stream
 * "tasks done today" are intentionally omitted — no aggregate endpoint exists.
 */
export function StreamsDashboard(): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const { data: streams = [], isLoading } = useStreams({ search: search || undefined });
  const createStream = useCreateStream();
  const deleteStream = useDeleteStream();

  const active = streams.filter((s) => ACTIVE.has(s.status)).length;
  const attention = streams.filter((s) => ATTENTION.has(s.status)).length;
  const kpis = [
    { key: 'active', label: t('dashboard.kpi.active'), value: active },
    { key: 'total', label: t('dashboard.kpi.total'), value: streams.length },
    { key: 'attention', label: t('dashboard.kpi.attention'), value: attention },
  ];

  const titleLength = draftTitle.trim().length;
  const canCreate =
    !createStream.isPending &&
    titleLength >= WORKY_STREAM_TITLE_MIN &&
    titleLength <= WORKY_STREAM_TITLE_MAX;

  const closeCreate = (): void => {
    setCreateOpen(false);
    setDraftTitle('');
  };

  const onCreate = async (): Promise<void> => {
    if (!canCreate) return;
    try {
      const stream = await createStream.mutateAsync({ title: draftTitle.trim() });
      closeCreate();
      navigate(`/worky/${stream.id}`);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('dashboard.createFailed'));
    }
  };

  const onDelete = async (stream: { id: string; title: string }): Promise<void> => {
    const confirmed = window.confirm(t('dashboard.deleteConfirm', { title: stream.title }));
    if (!confirmed) return;
    try {
      await deleteStream.mutateAsync(stream.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('dashboard.deleteFailed'));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="worky-stream-search"
              name="streamSearch"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('dashboard.searchPlaceholder')}
              className="h-9 pl-8"
            />
          </div>
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-testid="worky-new-stream"
            className="shrink-0"
          >
            <Plus className="mr-1 size-4" />
            {t('dashboard.newStream')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {kpis.map((k) => (
          <div key={k.key} data-testid={`kpi-${k.key}`} className="rounded-2xl border border-border bg-card p-5">
            <div className="text-sm text-muted-foreground">{k.label}</div>
            <div className="mt-2 text-3xl font-bold text-foreground">{k.value}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('dashboard.loading')}</p>
      ) : streams.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('dashboard.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {streams.map((s) => (
            <div
              key={s.id}
              className="group relative flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-accent/40"
            >
              <button
                type="button"
                onClick={() => navigate(`/worky/${s.id}`)}
                className="flex flex-col gap-2 text-left"
              >
                <div className="flex items-center gap-2 pr-8">
                  <span className="size-2 shrink-0 rounded-full bg-worky-working" />
                  <span className="truncate font-semibold text-foreground">{s.title}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t('header.planVersion', { version: s.currentPlanVersion })}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'absolute right-2 top-2 size-7 text-muted-foreground opacity-0 transition-opacity',
                  'hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100',
                )}
                aria-label={t('dashboard.deleteStream', { title: s.title })}
                disabled={deleteStream.isPending}
                onClick={() => void onDelete(s)}
              >
                {deleteStream.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.newStream')}</DialogTitle>
            <DialogDescription>{t('dashboard.newStreamDescription')}</DialogDescription>
          </DialogHeader>
          <Input
            id="worky-new-stream-title"
            name="streamTitle"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder={t('dashboard.newStreamPlaceholder')}
            maxLength={WORKY_STREAM_TITLE_MAX}
            disabled={createStream.isPending}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void onCreate();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeCreate} disabled={createStream.isPending}>
              {t('actions.cancel')}
            </Button>
            <Button type="button" onClick={() => void onCreate()} disabled={!canCreate}>
              {createStream.isPending ? <Loader2 className="size-4 animate-spin" /> : t('actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
