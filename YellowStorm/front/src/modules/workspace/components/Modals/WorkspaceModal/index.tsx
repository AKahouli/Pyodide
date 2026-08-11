/**
 * Workspace Modal
 * Large modal with sidebar for workspace list and content for documents
 * Responsive: sidebar toggleable on mobile, side-by-side on desktop
 */

import { memo, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useFileViewerMode } from '@/modules/file-viewer/store';
import { useWorkspaceStore, useWorkspaceModalState } from '../../../store';
import { WorkspaceModalContent } from './WorkspaceModalContent';

export const WorkspaceModal = memo(function WorkspaceModal() {
  const isModalOpen = useWorkspaceStore((state) => state.isModalOpen);
  const closeModal = useWorkspaceStore((state) => state.closeModal);
  const { isMobileSidebarOpen } = useWorkspaceModalState();
  const fileViewerMode = useFileViewerMode();
  const isFileViewerActive = fileViewerMode !== 'closed';

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeModal();
    },
    [closeModal],
  );

  return (
    <Dialog open={isModalOpen} onOpenChange={handleOpenChange} modal={!isFileViewerActive}>
      <DialogContent className='w-[95vw] max-w-7xl h-[90vh] md:h-[85vh] p-0 gap-0 overflow-hidden data-[state=open]:animate-none data-[state=closed]:animate-none' onInteractOutside={(e) => e.preventDefault()}>
        <WorkspaceModalContent isMobileSidebarOpen={isMobileSidebarOpen} />
      </DialogContent>
    </Dialog>
  );
});
