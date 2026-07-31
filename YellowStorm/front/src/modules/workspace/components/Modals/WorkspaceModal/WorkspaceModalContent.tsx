import { memo } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { WorkspaceSidebar } from '../../WorkspaceSidebar';
import { WorkspaceContent } from '../../WorkspaceContent';
import { DialogTitle } from '@/components/ui/dialog';

type WorkspaceModalContentProps = Readonly<{
  isMobileSidebarOpen: boolean;
}>;

export const WorkspaceModalContent = memo(function WorkspaceModalContent({ isMobileSidebarOpen }: WorkspaceModalContentProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <>
      <div className='flex h-full overflow-hidden'>
        <div
          className={`
            ${isMobileSidebarOpen ? 'flex' : 'hidden'}
            md:flex
            absolute inset-0
            md:relative md:inset-auto
            z-10 md:z-auto
            bg-background
            md:h-full md:shrink-0
          `}>
          <WorkspaceSidebar />
        </div>
        <div
          className={`
            ${isMobileSidebarOpen ? 'hidden' : 'flex'}
            md:flex
            flex-1
            min-w-0
            h-full
          `}>
          <WorkspaceContent />
        </div>
      </div>
      <DialogTitle className='sr-only'>{t('modal.managerTitle')}</DialogTitle>
    </>
  );
});
