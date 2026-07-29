import { RouterProvider } from 'react-router-dom';
import { CombinedProvider } from './providers/CombinedProvider';
import { SettingsModal } from './modules/profile';
import {
  CreateWorkspaceModal,
  CreateTemplateModal,
  WorkspaceSettingsModal,
  UploadProgress,
  ShareWorkspaceDialog,
  useShareNotifications,
} from './modules/workspace';
import { FileFloatingWindow } from './modules/file-viewer';
import { Toaster } from './components/ui/sonner';
import { router } from './Router';

function ShareNotificationsBridge() {
  useShareNotifications();
  return null;
}

export default function App() {
  return (
    <CombinedProvider>
      <RouterProvider router={router} />
      <SettingsModal />
      <CreateWorkspaceModal />
      <CreateTemplateModal />
      <WorkspaceSettingsModal />
      <ShareWorkspaceDialog />
      <ShareNotificationsBridge />
      <UploadProgress />
      <FileFloatingWindow />
      <Toaster position='top-right' richColors offset={80} closeButton />
    </CombinedProvider>
  );
}
