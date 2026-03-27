/**
 * Workspace Sidebar
 * Sidebar within the workspace modal showing workspace list with pagination
 */

import { useCallback, useEffect } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useWorkspaceStore, useWorkspaces, useWorkspacePagination, useWorkspaceLoading } from '../store';
import { useDebouncedSearch } from '../hooks';
import { WorkspaceItem } from './WorkspaceItem';
import { useModuleTranslation } from '@/modules/localization';

export function WorkspaceSidebar() {
  const { t } = useModuleTranslation('workspace');
  const workspaces = useWorkspaces();
  const { currentPage, totalPages } = useWorkspacePagination();
  const { isLoadingWorkspaces } = useWorkspaceLoading();

  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const searchWorkspaces = useWorkspaceStore((state) => state.searchWorkspaces);
  const openCreateModal = useWorkspaceStore((state) => state.openCreateModal);
  const selectedWorkspaceId = useWorkspaceStore((state) => state.selectedWorkspaceId);
  const isModalOpen = useWorkspaceStore((state) => state.isModalOpen);
  const closeModal = useWorkspaceStore((state) => state.closeModal);

  // Debounced search
  const { value: searchInput, onChange: handleSearchChange, reset: resetSearch } = useDebouncedSearch(useCallback((value: string) => searchWorkspaces(value), [searchWorkspaces]));

  // Reset search input when modal closes
  useEffect(() => {
    if (!isModalOpen) {
      resetSearch();
    }
  }, [isModalOpen, resetSearch]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleSearchChange(e.target.value);
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      fetchWorkspaces(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      fetchWorkspaces(currentPage + 1);
    }
  };

  return (
    <div className='w-full md:w-64 h-full border-r bg-muted/30 flex flex-col shrink-0'>
      {/* Header */}
      <div className='shrink-0 p-4 pb-2'>
        <div className='flex items-center justify-between mb-3'>
          <h2 className='text-lg font-semibold'>{t('sidebar.title')}</h2>
          {/* Close button - mobile only */}
          <Button variant='ghost' size='icon' className='h-8 w-8 md:hidden' onClick={closeModal}>
            <X className='h-4 w-4' />
            <span className='sr-only'>{t('sidebar.close')}</span>
          </Button>
        </div>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
          <Input placeholder={t('sidebar.searchPlaceholder')} value={searchInput} onChange={handleSearch} className='pl-9 h-9' />
        </div>
      </div>

      {/* Create button */}
      <div className='shrink-0 px-4 py-2'>
        <Button onClick={() => openCreateModal()} className='w-full' size='sm'>
          <Plus className='mr-2 h-4 w-4' />
          {t('sidebar.create')}
        </Button>
      </div>

      <Separator className='shrink-0' />

      {/* Workspace list — scrollable */}
      <div className='flex-1 min-h-0 overflow-y-auto px-2'>
        {isLoadingWorkspaces ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : workspaces.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-8 text-center'>
            <p className='text-sm text-muted-foreground'>{t('sidebar.empty.title')}</p>
            <p className='text-xs text-muted-foreground mt-1'>{t('sidebar.empty.description')}</p>
          </div>
        ) : (
          <div className='py-2 space-y-1'>
            {workspaces.map((workspace) => (
              <WorkspaceItem key={workspace.id} workspace={workspace} isSelected={selectedWorkspaceId === workspace.id} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination — pinned at bottom */}
      {totalPages > 1 && (
        <div className='shrink-0 border-t p-2 flex items-center justify-center gap-2'>
          <Button variant='ghost' size='icon' className='h-8 w-8' disabled={currentPage === 1 || isLoadingWorkspaces} onClick={handlePrevPage}>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <span className='text-sm text-muted-foreground min-w-15 text-center'>{t('sidebar.pagination', { current: currentPage, total: totalPages })}</span>
          <Button variant='ghost' size='icon' className='h-8 w-8' disabled={currentPage === totalPages || isLoadingWorkspaces} onClick={handleNextPage}>
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      )}
    </div>
  );
}
