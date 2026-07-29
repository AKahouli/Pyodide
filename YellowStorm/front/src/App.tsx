import React, { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { CombinedProvider } from './providers/CombinedProvider';
import { useShareNotifications } from './modules/workspace';
import { Toaster } from './components/ui/sonner';
import { router } from './Router';

const SettingsModal = React.lazy(() =>
  import('./modules/profile').then((m) => ({ default: m.SettingsModal }))
);
const CreateWorkspaceModal = React.lazy(() =>
  import('./modules/workspace').then((m) => ({ default: m.CreateWorkspaceModal }))
);
const CreateTemplateModal = React.lazy(() =>
  import('./modules/workspace').then((m) => ({ default: m.CreateTemplateModal }))
);
const WorkspaceSettingsModal = React.lazy(() =>
  import('./modules/workspace').then((m) => ({ default: m.WorkspaceSettingsModal }))
);
const ShareWorkspaceDialog = React.lazy(() =>
  import('./modules/workspace').then((m) => ({ default: m.ShareWorkspaceDialog }))
);
const UploadProgress = React.lazy(() =>
  import('./modules/workspace').then((m) => ({ default: m.UploadProgress }))
);
const FileFloatingWindow = React.lazy(() =>
  import('./modules/file-viewer').then((m) => ({ default: m.FileFloatingWindow }))
);

function ShareNotificationsBridge() {
  useShareNotifications();
  return null;
}

export default function App() {
  return (
    <CombinedProvider>
      <RouterProvider router={router} />
      <Suspense fallback={null}>
        <SettingsModal />
        <CreateWorkspaceModal />
        <CreateTemplateModal />
        <WorkspaceSettingsModal />
        <ShareWorkspaceDialog />
      </Suspense>
      <ShareNotificationsBridge />
      <Suspense fallback={null}>
        <UploadProgress />
        <FileFloatingWindow />
      </Suspense>
      <Toaster position='top-right' richColors offset={80} closeButton />
    </CombinedProvider>
  );
}
