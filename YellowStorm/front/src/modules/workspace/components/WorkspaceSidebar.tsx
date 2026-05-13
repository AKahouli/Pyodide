/**
 * Workspace Sidebar
 * Sidebar within the workspace modal showing workspace list with pagination
 * Supports Personal and Shared workspaces tabs
 */

import { useCallback, useEffect } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  useWorkspaceStore,
  useWorkspaces,
  useWorkspacePagination,
  useWorkspaceLoading,
  useSharedWorkspaces,
  useSharedPagination,
  useActiveTab,
} from '../store';
import { useDebouncedSearch } from '../hooks';
import { WorkspaceItem } from './WorkspaceItem';
import { SharedWorkspaceItem } from './SharedWorkspaceItem';
import { TabSwitcher } from './TabSwitcher';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceListItem } from '../types';
import { isWorkspace } from '../types';

export function WorkspaceSidebar() {
  const { t } = useModuleTranslation('workspace');
  const workspaces = useWorkspaces();
  const sharedWorkspaces = useSharedWorkspaces();
  const { currentPage, totalPages } = useWorkspacePagination();
  const { currentPage: sharedCurrentPage, totalPages: sharedTotalPages } = useSharedPagination();
  const activeTab = useActiveTab();
  const { isLoadingWorkspaces } = useWorkspaceLoading();

  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const fetchSharedWorkspaces = useWorkspaceStore((state) => state.fetchSharedWorkspaces);
  const searchWorkspaces = useWorkspaceStore((state) => state.searchWorkspaces);
  const openCreateModal = useWorkspaceStore((state) => state.openCreateModal);
  const selectedWorkspaceId = useWorkspaceStore((state) => state.selectedWorkspaceId);
  const isModalOpen = useWorkspaceStore((state) => state.isModalOpen);
  const closeModal = useWorkspaceStore((state) => state.closeModal);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const selectSharedWorkspace = useWorkspaceStore((state) => state.selectSharedWorkspace);

  const {
    value: searchInput,
    onChange: handleSearchChange,
    reset: resetSearch,
  } = useDebouncedSearch(useCallback((value: string) => searchWorkspaces(value), [searchWorkspaces]));

  useEffect(() => {
    if (!isModalOpen) {
      resetSearch();
    }
  }, [isModalOpen, resetSearch]);

  useEffect(() => {
    if (isModalOpen && activeTab === 'shared') {
      fetchSharedWorkspaces(1);
    }
  }, [activeTab, isModalOpen, fetchSharedWorkspaces]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleSearchChange(e.target.value);
  };

  const handlePrevPage = () => {
    if (activeTab === 'personal' && currentPage > 1) {
      fetchWorkspaces(currentPage - 1);
    } else if (activeTab === 'shared' && sharedCurrentPage > 1) {
      fetchSharedWorkspaces(sharedCurrentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (activeTab === 'personal' && currentPage < totalPages) {
      fetchWorkspaces(currentPage + 1);
    } else if (activeTab === 'shared' && sharedCurrentPage < sharedTotalPages) {
      fetchSharedWorkspaces(sharedCurrentPage + 1);
    }
  };

  const currentList: WorkspaceListItem[] =
    activeTab === 'personal' ? workspaces : sharedWorkspaces;
  const currentTotalPages = activeTab === 'personal' ? totalPages : sharedTotalPages;
  const currentPageNum = activeTab === 'personal' ? currentPage : sharedCurrentPage;

  return (
    <div className='w-full md:w-64 h-full border-r bg-muted/30 flex flex-col shrink-0'>
      <div className='shrink-0 p-4 pb-2'>
        <div className='flex items-center justify-between mb-2'>
          <h2 className='text-lg font-semibold'>{t('sidebar.title')}</h2>
          <Button variant='ghost' size='icon' className='h-8 w-8 md:hidden' onClick={closeModal}>
            <X className='h-4 w-4' />
            <span className='sr-only'>{t('sidebar.close')}</span>
          </Button>
        </div>

        <TabSwitcher activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'personal' && (
          <div className='relative mt-2'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchInput}
              onChange={handleSearch}
              className='pl-9 h-9'
            />
          </div>
        )}
      </div>

      {activeTab === 'personal' && (
        <>
          <div className='shrink-0 px-4 py-2'>
            <Button onClick={() => openCreateModal()} className='w-full' size='sm'>
              <Plus className='mr-2 h-4 w-4' />
              {t('sidebar.create')}
            </Button>
          </div>
          <Separator className='shrink-0' />
        </>
      )}

      <div className='flex-1 min-h-0 overflow-y-auto px-2'>
        {isLoadingWorkspaces ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : currentList.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-8 text-center'>
            <p className='text-sm text-muted-foreground'>
              {activeTab === 'personal'
                ? t('sidebar.empty.title')
                : t('sidebar.shared.empty.title')}
            </p>
            <p className='text-xs text-muted-foreground mt-1'>
              {activeTab === 'personal'
                ? t('sidebar.empty.description')
                : t('sidebar.shared.empty.description')}
            </p>
          </div>
        ) : (
          <div className='py-2 space-y-1'>
            {currentList.map((workspace) =>
              isWorkspace(workspace) ? (
                <WorkspaceItem
                  key={workspace.id}
                  workspace={workspace}
                  isSelected={selectedWorkspaceId === workspace.id}
                />
              ) : (
                <SharedWorkspaceItem
                  key={workspace.shareId}
                  workspace={workspace}
                  isSelected={selectedWorkspaceId === workspace.id}
                  onSelect={() => selectSharedWorkspace(workspace.id, workspace.shareId)}
                />
              ),
            )}
          </div>
        )}
      </div>

      {currentTotalPages > 1 && (
        <div className='shrink-0 border-t p-2 flex items-center justify-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            disabled={currentPageNum === 1 || isLoadingWorkspaces}
            onClick={handlePrevPage}
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <span className='text-sm text-muted-foreground min-w-15 text-center'>
            {t('sidebar.pagination', { current: currentPageNum, total: currentTotalPages })}
          </span>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            disabled={currentPageNum === currentTotalPages || isLoadingWorkspaces}
            onClick={handleNextPage}
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      )}
    </div>
  );
}
