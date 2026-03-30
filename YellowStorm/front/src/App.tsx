import { RouterProvider } from 'react-router-dom';
import { CombinedProvider } from './providers/CombinedProvider';
import { SettingsModal } from './modules/profile';
import { WorkspaceModal, CreateWorkspaceModal, CreateTemplateModal, WorkspaceSettingsModal, UploadProgress } from './modules/workspace';
import { FileFloatingWindow } from './modules/file-viewer';
import { Toaster } from './components/ui/sonner';
import { router } from './Router';

export default function App() {
  return (
    <CombinedProvider>
      <RouterProvider router={router} />
      <SettingsModal />
      <WorkspaceModal />
      <CreateWorkspaceModal />
      <CreateTemplateModal />
      <WorkspaceSettingsModal />
      <UploadProgress />
      <FileFloatingWindow />
      <Toaster position='top-right' richColors offset={80} />
    </CombinedProvider>
  );
}
