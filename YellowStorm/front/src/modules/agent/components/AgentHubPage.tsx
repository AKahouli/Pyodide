import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckSquare, Loader2, Plus, Sparkles, X } from 'lucide-react';

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
import { useAgentStore, useAgentsInitialized, useAgentsLoading } from '../store';
import { useAgentOperations } from '../hooks/useAgentOperations';
import { useAgentHubFilters } from '../hooks/useAgentHubFilters';
import { useAgentBulkDelete } from '../hooks/useAgentBulkDelete';
import { AgentHubOverview } from './hub/AgentHubOverview';
import { AgentHubFilters } from './hub/AgentHubFilters';
import { AgentHubGrid } from './hub/AgentHubGrid';
import { AgentHubBulkActionBar } from './hub/AgentHubBulkActionBar';
import { CreateEditAgentDialog } from './CreateEditAgentDialog';
import { A2APublishDialog } from './A2APublishDialog';
import { ShareAgentDialog } from './ShareAgentDialog';
import { useModuleTranslation } from '@/modules/localization';

export function AgentHubPage() {
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchAgentTypes = useAgentStore((s) => s.fetchAgentTypes);
  const isInitialized = useAgentsInitialized();
  const isLoading = useAgentsLoading();
  const { t } = useModuleTranslation('agent');

  const ops = useAgentOperations();
  const filters = useAgentHubFilters();

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);

  const bulk = useAgentBulkDelete(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
    setConfirmBulkOpen(false);
  });

  useEffect(() => {
    fetchAgents();
    fetchAgentTypes();
  }, [fetchAgents, fetchAgentTypes]);

  // Deep link for opening the edit dialog straight from a conversation task
  // header (/agents?edit=<agentId>).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !isInitialized) return;
    const agent = useAgentStore.getState().getAgentById(editId);
    if (agent) ops.openEdit(agent);
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [searchParams, isInitialized, ops.openEdit, setSearchParams]);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const handleSelectChange = useCallback((id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleConfirmBulkDelete = useCallback(async () => {
    await bulk.runBulkDelete(Array.from(selectedIds));
  }, [bulk, selectedIds]);

  const showInitialLoader = isLoading && !isInitialized;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="relative border-b border-border/60 px-6 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              {t('button.agents')}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('hub.title')}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {t('hub.subtitle')}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              variant={selectMode ? 'secondary' : 'outline'}
              size="sm"
              onClick={handleToggleSelectMode}
            >
              <CheckSquare className="mr-1.5 h-4 w-4" />
              {t(selectMode ? 'hub.select.cancel' : 'hub.select.enter')}
            </Button>
            <Button onClick={ops.openCreate} className="shadow-sm">
              <Plus className="mr-1.5 h-4 w-4" />
              {t('hub.newAgent')}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 sm:px-10">
          <AgentHubOverview
            activeOwner={filters.filters.owner}
            onSelectOwner={filters.setOwner}
          />

          {selectMode && selectedIds.size > 0 && (
            <AgentHubBulkActionBar
              selectedCount={selectedIds.size}
              inFlight={bulk.inFlight}
              done={bulk.done}
              total={bulk.total}
              onClear={handleClearSelection}
              onDelete={() => setConfirmBulkOpen(true)}
            />
          )}

          <AgentHubFilters
            searchInput={filters.searchInput}
            onSearchChange={filters.setSearchInput}
            type={filters.filters.type}
            onTypeChange={filters.setType}
            owner={filters.filters.owner}
            onOwnerChange={filters.setOwner}
            sort={filters.filters.sort}
            onSortChange={filters.setSort}
            view={filters.filters.view}
            onViewChange={filters.setView}
            hasActiveFilters={filters.hasActiveFilters}
            onClearAll={filters.clearAll}
          />

          {showInitialLoader ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filters.isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="max-w-sm text-sm text-muted-foreground">
                {filters.hasActiveFilters
                  ? t('hub.filters.noResults')
                  : t('list.emptyState')}
              </p>
              {filters.hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={filters.clearAll}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  {t('hub.filters.clear')}
                </Button>
              ) : (
                <Button size="sm" onClick={ops.openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t('hub.newAgent')}
                </Button>
              )}
            </div>
          ) : (
            <AgentHubGrid
              groups={filters.filteredGroups}
              view={filters.filters.view}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onSelectChange={handleSelectChange}
              onEdit={ops.openEdit}
              onDelete={ops.setDeletingAgent}
              onView={ops.openView}
              onDuplicate={ops.duplicateAgent}
              onPublishA2A={ops.publishOrRotateA2A}
              onRevokeA2A={ops.setRevokingAgent}
              onShare={ops.setSharingAgent}
              onUnshare={ops.unshareAgent}
              publishingA2AId={ops.a2aProcessingId}
            />
          )}
        </div>
      </div>

      <CreateEditAgentDialog
        open={ops.showCreateEditDialog}
        onOpenChange={(open) => {
          ops.setShowCreateEditDialog(open);
        }}
        agent={ops.editingAgent}
        onSave={ops.handleSave}
        saving={ops.saving}
      />

      <A2APublishDialog result={ops.a2aResult} onClose={() => ops.setA2aResult(null)} />

      {ops.sharingAgent && (
        <ShareAgentDialog
          open={!!ops.sharingAgent}
          onOpenChange={(open) => {
            if (!open) ops.setSharingAgent(null);
          }}
          agent={ops.sharingAgent}
        />
      )}

      <AlertDialog
        open={!!ops.revokingAgent}
        onOpenChange={(open) => {
          if (!open) ops.setRevokingAgent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('a2a.revokeDialog.title', { defaultValue: 'Revoke A2A agent?' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('a2a.revokeDialog.description', {
                defaultValue:
                  'This agent will stop serving over A2A and its API key will be invalidated. You can publish it again later.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('list.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={ops.confirmRevokeA2A}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('a2a.revokeDialog.confirm', { defaultValue: 'Revoke' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ops.viewingAgent && (
        <CreateEditAgentDialog
          open={!!ops.viewingAgent}
          onOpenChange={(open) => {
            if (!open) ops.setViewingAgent(null);
          }}
          agent={ops.viewingAgent}
          onSave={ops.handleSave}
          saving={false}
          readOnly
        />
      )}

      <AlertDialog
        open={!!ops.deletingAgent}
        onOpenChange={(open) => {
          if (!open) ops.setDeletingAgent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('list.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('list.deleteDialog.descriptionStart')}{' '}
              <strong>{ops.deletingAgent?.name}</strong>
              {t('list.deleteDialog.descriptionEnd')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('list.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={ops.confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('list.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmBulkOpen}
        onOpenChange={(open) => {
          if (!bulk.inFlight) setConfirmBulkOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('hub.bulkActions.confirmTitle', { count: selectedIds.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('hub.bulkActions.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulk.inFlight}>
              {t('list.deleteDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkDelete}
              disabled={bulk.inFlight}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulk.inFlight ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('hub.bulkActions.deleting', { done: bulk.done, total: bulk.total })}
                </>
              ) : (
                t('list.deleteDialog.confirm')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
