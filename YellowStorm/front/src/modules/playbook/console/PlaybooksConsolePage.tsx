import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';
import { useModuleTranslation } from '@/modules/localization';
import * as api from '../api';
import { usePlaybookStore } from '../store';
import type { PlaybookState, PlaybookVM } from '../utils/playbookVM';
import { neverRun } from '../utils/playbookVM';
import { CreatePlaybookDialog } from '../components/CreatePlaybookDialog';
import { EditPlaybookDetailsDialog } from '../components/EditPlaybookDetailsDialog';
import { PlaybookBetaDisclaimer } from '../components/PlaybookBetaDisclaimer';
import {
  comparePlaybooks, matchesPlaybook, parseConsoleState, segmentCounts, SEGMENT_PREDICATES, serializeConsoleState, VIEW_STORAGE_KEY,
  type ConsoleState, type SegmentId, type SortKey,
} from './consoleState';
import { useConsoleData } from './useConsoleData';
import { AttentionRail } from './AttentionRail';
import { SegmentTabs } from './SegmentTabs';
import { FilterBar } from './FilterBar';
import { PlaybookTable } from './PlaybookTable';
import { PlaybookCardsView } from './PlaybookCardsView';
import { PlaybookBoard } from './PlaybookBoard';
import { PlaybookDrawer } from './PlaybookDrawer';
import { BulkActionBar } from './BulkActionBar';
import { TidyBanner } from './TidyBanner';
import { CommandPalette } from './CommandPalette';
import type { PlaybookActions } from './types';

export function PlaybooksConsolePage() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');
  const { vms, raws, loading, error, refresh, patchRaw } = useConsoleData();
  const generateRetryData = usePlaybookStore((s) => s.generateRetryData);
  const clearGenerateRetry = usePlaybookStore((s) => s.clearGenerateRetry);

  const [searchParams, setSearchParams] = useSearchParams();
  const storedView = useMemo(
    () => (['table', 'board', 'cards'] as const).find((v) => v === localStorage.getItem(VIEW_STORAGE_KEY)) ?? null,
    [],
  );
  const state = useMemo(() => parseConsoleState(searchParams, storedView, vms.length), [searchParams, storedView, vms.length]);

  const patch = useCallback(
    (next: Partial<ConsoleState>) => {
      setSearchParams(serializeConsoleState({ ...state, ...next }), { replace: true });
      if (next.view) localStorage.setItem(VIEW_STORAGE_KEY, next.view);
    },
    [state, setSearchParams],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<PlaybookVM[] | null>(null);
  const [stopTarget, setStopTarget] = useState<PlaybookVM | null>(null);
  const [integrationVm, setIntegrationVm] = useState<PlaybookVM | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (generateRetryData) setCreateOpen(true);
  }, [generateRetryData]);

  // Selection clears on segment change (§7.10).
  const segRef = useRef(state.seg);
  useEffect(() => {
    if (segRef.current !== state.seg) {
      segRef.current = state.seg;
      setSelected(new Set());
    }
  }, [state.seg]);

  // ⌘K palette + "/" focuses search (§7.9).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (e.key === '/' && !inInput) {
        e.preventDefault();
        searchRef.current?.querySelector<HTMLInputElement>('input')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- derived ----
  const counts = useMemo(() => segmentCounts(vms), [vms]);
  const segmentVms = useMemo(() => vms.filter(SEGMENT_PREDICATES[state.seg]), [vms, state.seg]);
  const statesPresent = useMemo(() => {
    const byState = new Map<PlaybookState, number>();
    for (const vm of segmentVms) byState.set(vm.state, (byState.get(vm.state) ?? 0) + 1);
    return [...byState.entries()].map(([s, count]) => ({ state: s, count })).sort((a, b) => b.count - a.count);
  }, [segmentVms]);
  const visible = useMemo(
    () => [...segmentVms.filter((vm) => matchesPlaybook(vm, state))].sort((a, b) => comparePlaybooks(a, b, state.sort, state.dir)),
    [segmentVms, state],
  );
  const showReliability = useMemo(() => vms.some((vm) => vm.history !== null), [vms]);
  const duplicateGroups = useMemo(
    () => new Set(vms.filter((vm) => vm.duplicateOfId).map((vm) => vm.duplicateOfId)).size,
    [vms],
  );
  const neverRunCount = useMemo(() => vms.filter(neverRun).length, [vms]);

  // ---- actions ----
  const openCanvas = useCallback((id: string, search = '') => {
    navigate(`/playbooks/${id}${search}`, { state: { autoLayoutOnOpen: true } });
  }, [navigate]);

  const actions: PlaybookActions = useMemo(() => ({
    onOpen: (vm) => setDrawerId(vm.id),
    onRun: (vm) => {
      void usePlaybookStore.getState().executePlaybook(vm.id).then(() => {
        toast.success(t('console.toast.runStarted', { name: vm.name }));
      }).catch(() => { /* store toasts the error */ });
    },
    onEditCanvas: (vm) => openCanvas(vm.id),
    onEditDetails: (vm) => setEditingId(vm.id),
    onClone: (vm) => {
      void api.clonePlaybook(vm.id).then(() => {
        toast.success(t('console.toast.cloned', { name: vm.name }));
        void refresh();
      }).catch(() => toast.error(t('console.toast.cloneFailed')));
    },
    onDelete: (vm) => setDeleteTargets([vm]),
    onToggleFavorite: (vm) => {
      patchRaw(vm.id, { isFavorite: !vm.isFavorite });
      void api.toggleFavorite(vm.id).catch(() => {
        patchRaw(vm.id, { isFavorite: vm.isFavorite });
        toast.error(t('console.toast.favoriteFailed'));
      });
    },
    onOpenTriggers: (vm) => openCanvas(vm.id, '?triggers=1'),
    onIntegration: (vm) => setIntegrationVm(vm),
    onWatchRun: (vm) => {
      const runId = vm.live?.runId ?? vm.approval?.runId ?? vm.recentRuns[0]?.id;
      navigate(runId ? `/playbooks/${vm.id}/executions/${runId}` : `/playbooks/${vm.id}/executions`);
    },
  }), [navigate, openCanvas, refresh, t, patchRaw]);

  const railActions = useMemo(() => ({
    onWatchRun: actions.onWatchRun,
    onStop: (vm: PlaybookVM) => setStopTarget(vm),
    onApprove: (vm: PlaybookVM) => {
      if (!vm.approval) return;
      void usePlaybookStore.getState()
        .resumeExecution(vm.id, {
          executionId: vm.approval.runId,
          taskId: vm.approval.taskId,
          interruptId: vm.approval.interruptId,
          action: 'approve',
          approved: true,
        })
        .then(() => toast.success(t('console.toast.approved', { name: vm.name })))
        .catch(() => { /* store toasts the error */ });
    },
    onRetry: (vm: PlaybookVM) => {
      if (vm.failure?.runId) {
        void api.reExecuteExecution(vm.failure.runId).then(() => {
          toast.success(t('console.toast.retryStarted', { name: vm.name }));
        }).catch(() => toast.error(t('console.toast.retryFailed', { name: vm.name })));
      } else {
        actions.onRun(vm);
      }
    },
    onMore: (segment: SegmentId, states: PlaybookState[]) => patch({ seg: segment, states }),
  }), [actions, patch, t]);

  const onSort = useCallback((key: SortKey) => {
    const dir: ConsoleState['dir'] =
      state.sort === key ? (state.dir === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc';
    patch({ sort: key, dir });
  }, [state.sort, state.dir, patch]);

  const confirmDelete = useCallback(() => {
    if (!deleteTargets?.length) return;
    const ids = deleteTargets.map((vm) => vm.id);
    void api.bulkDeletePlaybooks(ids).then(() => {
      toast.success(t('console.toast.deleted', { count: ids.length }));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setDrawerId((id) => (id && ids.includes(id) ? null : id));
      void refresh();
    }).catch(() => toast.error(t('console.toast.deleteFailed')));
    setDeleteTargets(null);
  }, [deleteTargets, refresh, t]);

  const drawerVm = drawerId ? vms.find((vm) => vm.id === drawerId) ?? null : null;
  const editingRaw = editingId ? raws?.find((item) => item.id === editingId) ?? null : null;
  const integrationLink = integrationVm?.integrationToken
    ? `${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.publicExecute(integrationVm.integrationToken)}`
    : '';

  // ---- render ----
  const segmentEmpty = !loading && !error && vms.length > 0 && segmentVms.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 sm:px-6">
        <h1 className="text-[19px] font-semibold leading-tight">
          {t('list.title')}
          {vms.length > 0 && <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{vms.length}</span>}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setPaletteOpen(true)}>
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('console.palette.open')}</span>
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('list.newPlaybook')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-16" data-testid="playbooks-console">
        {error ? (
          <div className="m-6 rounded-lg border bg-card p-4" role="alert">
            <p className="text-sm text-muted-foreground">{t('console.error.load')}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {t('console.error.retry')}
            </Button>
          </div>
        ) : loading ? (
          <ConsoleSkeleton />
        ) : vms.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <p className="mb-4 text-muted-foreground">{t('list.empty')}</p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('list.newPlaybook')}
            </Button>
          </div>
        ) : (
          <>
            <AttentionRail vms={vms} actions={railActions} />
            <TidyBanner
              neverRunCount={neverRunCount}
              duplicateCount={duplicateGroups}
              onReview={() => patch({ dupOnly: true, seg: 'all', states: [], q: '' })}
            />
            <div className="mt-3 border-b" />
            <SegmentTabs counts={counts} active={state.seg} onChange={(seg) => patch({ seg })} />
            <div className="border-b" />
            <div ref={searchRef}>
              <FilterBar
                state={state}
                onChange={patch}
                statesPresent={statesPresent}
                segmentCounts={{ matched: visible.length, total: segmentVms.length }}
              />
            </div>
            <div className="border-b" />

            {visible.length === 0 ? (
              segmentEmpty ? (
                <p className="p-10 text-center text-sm text-muted-foreground">{t('console.emptySegment', { segment: t(`console.segment.${state.seg}`) })}</p>
              ) : (
                <div className="flex flex-col items-center justify-center p-10 text-center">
                  <p className="mb-4 text-sm text-muted-foreground">
                    {state.q ? t('console.noMatch', { q: state.q }) : t('list.noResults')}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => patch({ q: '', states: [], minSteps: undefined, maxSteps: undefined, from: undefined, to: undefined, dupOnly: false })}>
                    {t('list.clearFilters')}
                  </Button>
                </div>
              )
            ) : state.view === 'cards' ? (
              <PlaybookCardsView vms={visible} actions={actions} />
            ) : state.view === 'board' ? (
              <PlaybookBoard vms={visible} actions={actions} />
            ) : (
              <PlaybookTable
                vms={visible}
                sort={state.sort}
                dir={state.dir}
                onSort={onSort}
                selected={selected}
                onToggleSelect={(id) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                actions={actions}
                showReliability={showReliability}
              />
            )}
          </>
        )}
      </div>

      <BulkActionBar
        count={selected.size}
        onRun={() => {
          selected.forEach((id) => {
            const vm = vms.find((v) => v.id === id);
            if (vm) actions.onRun(vm);
          });
          setSelected(new Set());
        }}
        onClone={() => {
          const ids = [...selected];
          setSelected(new Set());
          void Promise.all(ids.map((id) => api.clonePlaybook(id).catch(() => null))).then(() => {
            toast.success(t('console.toast.bulkClone', { count: ids.length }));
            void refresh();
          });
        }}
        onDelete={() => setDeleteTargets(selected.size ? vms.filter((vm) => selected.has(vm.id)) : null)}
        onClear={() => setSelected(new Set())}
      />

      <PlaybookDrawer vm={drawerVm} actions={actions} onOpenRun={(vmId, runId) => navigate(`/playbooks/${vmId}/executions/${runId}`)} onClose={() => setDrawerId(null)} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        vms={vms}
        actions={{
          onNew: () => setCreateOpen(true),
          onSegment: (seg) => patch({ seg }),
          onNeedsHuman: () => patch({ seg: 'live', states: ['awaiting_approval'] }),
          onView: (view) => patch({ view }),
          onSort: (sort) => patch({ sort, dir: sort === 'name' ? 'asc' : 'desc' }),
          onOpen: (vm) => setDrawerId(vm.id),
        }}
      />

      {/* Stop confirmation — destructive, names the playbook (§7.2). */}
      <AlertDialog open={stopTarget !== null} onOpenChange={(open) => { if (!open) setStopTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('console.stop.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('console.stop.description', { name: stopTarget?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('console.stop.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (stopTarget) {
                  const runId = stopTarget.live?.runId ?? stopTarget.approval?.runId;
                  if (runId) void usePlaybookStore.getState().stopExecution(stopTarget.id, runId);
                }
                setStopTarget(null);
              }}
            >
              {t('console.rail.stop')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation — single row and bulk share it. */}
      <AlertDialog open={deleteTargets !== null} onOpenChange={(open) => { if (!open) setDeleteTargets(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('list.deleteSelectedConfirm', { count: deleteTargets?.length ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargets?.map((vm) => vm.name).join(', ')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('card.deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
              {t('card.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Integration URL — capability parity with the old ⋯ menu (§1.2). */}
      <Dialog open={integrationVm !== null} onOpenChange={(open) => { if (!open) setIntegrationVm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('card.integration.title')}</DialogTitle>
            <DialogDescription>{t('card.integration.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={integrationLink}
              readOnly
              disabled={!integrationLink}
              placeholder={t('console.integration.unavailable')}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={!integrationLink}
              onClick={() => {
                void navigator.clipboard?.writeText(integrationLink).then(() => toast.success(t('card.integration.copied')));
              }}
            >
              {t('card.integration.copy')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreatePlaybookDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open && generateRetryData) clearGenerateRetry();
        }}
        retryData={generateRetryData}
      />
      <EditPlaybookDetailsDialog
        open={editingRaw !== null}
        onOpenChange={(open) => { if (!open) setEditingId(null); }}
        playbook={editingRaw}
        onSaved={(updated) => {
          if (editingRaw) {
            patchRaw(editingRaw.id, { name: updated.name, description: updated.description });
            void refresh();
          }
        }}
      />
      <PlaybookBetaDisclaimer />
    </div>
  );
}

function ConsoleSkeleton() {
  const { t } = useModuleTranslation('playbook');
  return (
    <div aria-busy="true" aria-label={t('console.loading')}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(288px,1fr))] gap-3 p-4 sm:px-6">
        {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
      </div>
      <div className="space-y-2 p-4 sm:px-6">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}
      </div>
    </div>
  );
}
