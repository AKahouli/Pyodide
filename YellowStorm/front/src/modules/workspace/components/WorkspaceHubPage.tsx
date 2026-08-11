import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Layers, Loader2, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWorkspaceStore, useWorkspaceLoading, useAllWorkspaces } from '../store';
import {
  useWorkspaceHubFilters,
  type WorkspaceHubItem,
} from '../hooks/useWorkspaceHubFilters';
import { WorkspaceHubOverview } from './hub/WorkspaceHubOverview';
import { WorkspaceHubFilters } from './hub/WorkspaceHubFilters';
import { WorkspaceHubGrid } from './hub/WorkspaceHubGrid';

export function WorkspaceHubPage() {
  const navigate = useNavigate();
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const fetchSharedWorkspaces = useWorkspaceStore((s) => s.fetchSharedWorkspaces);
  const fetchPublicWorkspaces = useWorkspaceStore((s) => s.fetchPublicWorkspaces);
  const openCreateModal = useWorkspaceStore((s) => s.openCreateModal);
  const openSettingsModal = useWorkspaceStore((s) => s.openSettingsModal);
  const openShareModal = useWorkspaceStore((s) => s.openShareModal);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const { isLoadingWorkspaces } = useWorkspaceLoading();
  const ownedWorkspaces = useAllWorkspaces();

  const filters = useWorkspaceHubFilters();
  const minePageSize = 9;
  const [minePage, setMinePage] = useState(1);

  const mineTotalPages = Math.max(1, Math.ceil(filters.filteredGroups.mine.length / minePageSize));

  const showMinePagination =
    (filters.filters.owner === 'mine' || filters.filters.owner === 'all') && mineTotalPages > 1;

  useEffect(() => {
    // Keep page index in range when search/filter changes.
    setMinePage((p) => Math.min(Math.max(1, p), mineTotalPages));
  }, [mineTotalPages, filters.filters.owner, filters.searchInput]);

  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceHubItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadAllPages = async () => {
      // Owned workspaces
      // The store injects personal workspace into each fetched page, so we
      // stop based on the *non-personal* (mine) count.
      let page = 1;
      const MAX_PAGES = 50;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (page > MAX_PAGES) return;

        await fetchWorkspaces(page);

        const state = useWorkspaceStore.getState();
        const pageItems = state.workspaces.get(page) ?? [];
        const mineCount = pageItems.filter((w) => !w.isPersonal).length;

        // Once we reached an empty "mine" page beyond page 1,
        // additional pages are guaranteed to be empty too.
        if (page > 1 && mineCount === 0) break;
        page += 1;
      }

      // Shared workspaces
      page = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (page > MAX_PAGES) return;

        await fetchSharedWorkspaces(page);
        const state = useWorkspaceStore.getState();
        const pageItems = state.sharedWorkspaces.get(page) ?? [];
        if (page > 1 && pageItems.length === 0) break;
        page += 1;
      }

      // Public workspaces
      page = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (page > MAX_PAGES) return;

        await fetchPublicWorkspaces(page);
        const state = useWorkspaceStore.getState();
        const pageItems = state.publicWorkspaces.get(page) ?? [];
        if (page > 1 && pageItems.length === 0) break;
        page += 1;
      }
    };

    void loadAllPages();

    return () => {
      cancelled = true;
    };
  }, [fetchWorkspaces, fetchSharedWorkspaces, fetchPublicWorkspaces]);

  const handleOpen = (id: string) => navigate(`/workspace/${id}`);

  const handleSettings = (id: string) => {
    const ws = ownedWorkspaces.find((w) => w.id === id);
    if (ws) openSettingsModal(ws);
  };

  const handleShare = (id: string) => {
    const ws = ownedWorkspaces.find((w) => w.id === id);
    if (ws) openShareModal(ws);
  };

  const confirmDelete = async () => {
    if (!deletingWorkspace) return;
    setIsDeleting(true);
    try {
      await deleteWorkspace(deletingWorkspace.id);
      setDeletingWorkspace(null);
    } catch {
      // toast handled by store
    } finally {
      setIsDeleting(false);
    }
  };

  const showInitialLoader =
    isLoadingWorkspaces &&
    filters.counts.mine === 0 &&
    filters.counts.shared === 0 &&
    filters.counts.public === 0;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="relative border-b border-border/60 px-6 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Layers className="h-3 w-3" />
              Workspaces
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Mes workspaces
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Organisez, classez et indexez vos documents au sein de vos workspaces.
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button onClick={() => openCreateModal()} className="shadow-sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Nouveau workspace
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 sm:px-10">
          <WorkspaceHubOverview
            counts={filters.counts}
            activeOwner={filters.filters.owner}
            onSelectOwner={filters.setOwner}
          />

          <WorkspaceHubFilters
            searchInput={filters.searchInput}
            onSearchChange={filters.setSearchInput}
            owner={filters.filters.owner}
            onOwnerChange={filters.setOwner}
            sort={filters.filters.sort}
            onSortChange={filters.setSort}
            view={filters.filters.view}
            onViewChange={filters.setView}
            hasActiveFilters={filters.hasActiveFilters}
            onClearAll={filters.clearAll}
          />

          {showMinePagination && (
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-2">
              <div className="text-sm text-muted-foreground">
                Mes workspaces - Page <span className="font-semibold text-foreground">{minePage}</span> /{' '}
                <span className="font-semibold text-foreground">{mineTotalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={minePage <= 1}
                  onClick={() => setMinePage((p) => Math.max(1, p - 1))}
                  className="gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={minePage >= mineTotalPages}
                  onClick={() => setMinePage((p) => Math.min(mineTotalPages, p + 1))}
                  className="gap-2"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {showInitialLoader ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filters.isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
                <Layers className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="max-w-sm text-sm text-muted-foreground">
                {filters.hasActiveFilters
                  ? 'Aucun workspace ne correspond à votre recherche.'
                  : "Vous n'avez pas encore de workspace. Créez-en un pour commencer."}
              </p>
              {filters.hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={filters.clearAll}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Effacer les filtres
                </Button>
              ) : (
                <Button size="sm" onClick={() => openCreateModal()}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Nouveau workspace
                </Button>
              )}
            </div>
          ) : (
            <WorkspaceHubGrid
              groups={{
                ...filters.filteredGroups,
                mine: filters.filteredGroups.mine.slice(
                  (minePage - 1) * minePageSize,
                  minePage * minePageSize,
                ),
              }}
              view={filters.filters.view}
              onOpen={handleOpen}
              onSettings={handleSettings}
              onShare={handleShare}
              onDelete={setDeletingWorkspace}
            />
          )}
        </div>
      </div>

      <AlertDialog
        open={!!deletingWorkspace}
        onOpenChange={(open) => {
          if (!isDeleting && !open) setDeletingWorkspace(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous vraiment supprimer définitivement{' '}
              <strong>{deletingWorkspace?.name}</strong> ainsi que ses{' '}
              {deletingWorkspace?.documentCount ?? 0} document(s) ? Cette action est
              irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
