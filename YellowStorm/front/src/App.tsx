import React, { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { CombinedProvider } from './providers/CombinedProvider';
import { useSettingsModal } from './modules/profile/SettingsContext';
import {
  useHasActiveUploads,
  useWorkspaceModalState,
  useWorkspaceStore,
} from './modules/workspace/store';
import { useShareNotifications } from './modules/workspace/hooks/useShareNotifications';
import { useFileViewerDisplayMode, useFileViewerMode } from './modules/file-viewer/store';
import { Toaster } from './components/ui/sonner';
import { router } from './Router';
import { useRecordCitationStore } from './modules/semantic-model/citations/record-citation-store';

const SettingsModal = React.lazy(() =>
  import('./modules/profile/components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const CreateWorkspaceModal = React.lazy(() =>
  import('./modules/workspace/components/Modals/CreateWorkspaceModal').then((m) => ({
    default: m.CreateWorkspaceModal,
  })),
);
const CreateTemplateModal = React.lazy(() =>
  import('./modules/workspace/components/Modals/CreateTemplateModal').then((m) => ({
    default: m.CreateTemplateModal,
  })),
);
const WorkspaceSettingsModal = React.lazy(() =>
  import('./modules/workspace/components/Modals/WorkspaceSettingsModal').then((m) => ({
    default: m.WorkspaceSettingsModal,
  })),
);
const ShareWorkspaceDialog = React.lazy(() =>
  import('./modules/workspace/components/ShareWorkspaceDialog').then((m) => ({
    default: m.ShareWorkspaceDialog,
  })),
);
const UploadProgress = React.lazy(() =>
  import('./modules/workspace/components/UploadProgress').then((m) => ({
    default: m.UploadProgress,
  })),
);
const FileFloatingWindow = React.lazy(() =>
  import('./modules/file-viewer/components/FileFloatingWindow').then((m) => ({
    default: m.FileFloatingWindow,
  })),
);

function ShareNotificationsBridge() {
  useShareNotifications();
  return null;
}

function DeferredSettingsModal() {
  const { isOpen } = useSettingsModal();
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <SettingsModal />
    </Suspense>
  );
}

function DeferredWorkspaceModals() {
  const { isCreateModalOpen, isCreateTemplateModalOpen, isSettingsModalOpen } = useWorkspaceModalState();
  const isShareDialogOpen = useWorkspaceStore((s) => s.isShareModalOpen);
  const hasActiveUploads = useHasActiveUploads();

  return (
    <>
      {isCreateModalOpen ? (
        <Suspense fallback={null}>
          <CreateWorkspaceModal />
        </Suspense>
      ) : null}
      {isCreateTemplateModalOpen ? (
        <Suspense fallback={null}>
          <CreateTemplateModal />
        </Suspense>
      ) : null}
      {isSettingsModalOpen ? (
        <Suspense fallback={null}>
          <WorkspaceSettingsModal />
        </Suspense>
      ) : null}
      {isShareDialogOpen ? (
        <Suspense fallback={null}>
          <ShareWorkspaceDialog />
        </Suspense>
      ) : null}
      {hasActiveUploads ? (
        <Suspense fallback={null}>
          <UploadProgress />
        </Suspense>
      ) : null}
    </>
  );
}

const RecordCitationDrawer = React.lazy(() => import('./modules/semantic-model/citations/RecordCitationDrawer'));

/** The record a chat citation opens, loaded the first time one is opened. */
function DeferredRecordCitationDrawer() {
  const opened = useRecordCitationStore((state) => state.target !== null);
  const [wanted, setWanted] = React.useState(false);
  React.useEffect(() => { if (opened) setWanted(true); }, [opened]);
  if (!wanted && !opened) return null;
  return (
    <Suspense fallback={null}>
      <RecordCitationDrawer />
    </Suspense>
  );
}

function DeferredFileFloatingWindow() {
  const mode = useFileViewerMode();
  const displayMode = useFileViewerDisplayMode();
  if (mode === 'closed' || displayMode !== 'floating') return null;
  return (
    <Suspense fallback={null}>
      <FileFloatingWindow />
    </Suspense>
  );
}

export default function App() {
  return (
    <CombinedProvider>
      <RouterProvider router={router} />
      <DeferredSettingsModal />
      <DeferredWorkspaceModals />
      <ShareNotificationsBridge />
      <DeferredFileFloatingWindow />
      <DeferredRecordCitationDrawer />
      <Toaster position='top-right' richColors offset={80} closeButton />
    </CombinedProvider>
  );
}
