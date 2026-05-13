/**
 * Workspace Module
 * Exports all workspace-related components and utilities
 */

// Types
export * from './types';

// API
export * from './api';

// Utils
export { formatFileSize, formatDate, getFileTypeLabel, validateFiles, ALLOWED_MIME_TYPES, ACCEPT_EXTENSIONS, MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, SMALL_FILE_THRESHOLD, DEFAULT_PAGE_LIMIT } from './utils';

// Store
export { useWorkspaceStore, useWorkspaces, useDocuments, useSelectedWorkspace, useCurrentWorkspaceSettings, useSettingsTargetWorkspace, useWorkspaceModalState, useWorkspaceLoading, useWorkspacePagination, useDocumentPagination, useUploadQueue, useUploadState, useHasActiveUploads } from './store';

// Hooks
export { useDocumentSelection } from './hooks';

// Components
export { WorkspaceButton } from './components/WorkspaceButton';
export { WorkspaceModal } from './components/Modals/WorkspaceModal';
export { WorkspaceSidebar } from './components/WorkspaceSidebar';
export { WorkspaceItem } from './components/WorkspaceItem';
export { WorkspaceContent } from './components/WorkspaceContent';
export { DocumentsTable } from './components/DocumentsTable';
export { default as DocumentRow } from './components/DocumentRow';
export { FloatingActionBar } from './components/FloatingActionBar';
export { CreateWorkspaceModal } from './components/Modals/CreateWorkspaceModal';
export { CreateWorkspaceStep1 } from './components/Modals/CreateWorkspaceModal/CreateWorkspaceStep1';
export { CreateWorkspaceStep2 } from './components/Modals/CreateWorkspaceModal/CreateWorkspaceStep2';
export { CreateTemplateModal } from './components/Modals/CreateTemplateModal';
export { CreateTemplateStep1 } from './components/Modals/CreateTemplateModal/CreateTemplateStep1';
export { CreateTemplateStep2 } from './components/Modals/CreateTemplateModal/CreateTemplateStep2';
export { WorkspaceSettingsModal } from './components/Modals/WorkspaceSettingsModal';
export { StepIndicator } from './components/StepIndicator';
export { UploadDropZone } from './components/UploadDropZone';
export { UploadButton } from './components/UploadButton';
export { UploadProgress } from './components/UploadProgress';
export { ShareWorkspaceDialog } from './components/ShareWorkspaceDialog';
export { useShareNotifications } from './hooks/useShareNotifications';
