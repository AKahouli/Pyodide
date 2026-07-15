/**
 * Workspace Module
 * Exports all workspace-related components and utilities
 */

// Types
export * from './types';

// API
export * from './api';
export * from './artifact-api';

// Utils
export { formatFileSize, formatDate, getFileTypeLabel, validateFiles, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, SMALL_FILE_THRESHOLD, DEFAULT_PAGE_LIMIT } from './utils';

// Store
export { useWorkspaceStore, useWorkspaces, useDocuments, useSelectedWorkspace, useCurrentWorkspaceSettings, useSettingsTargetWorkspace, useWorkspaceModalState, useWorkspaceLoading, useWorkspacePagination, useDocumentPagination, useUploadQueue, useUploadState, useHasActiveUploads } from './store';

// Page (was modules/classifier)
export { WorkspacePage } from './components/WorkspacePage';
export { WorkspaceHubPage } from './components/WorkspaceHubPage';
export { DecisionFlowEditorPage } from './components/decision-flow/DecisionFlowEditorPage';

// Components
export { WorkspaceButton } from './components/WorkspaceButton';
export { WorkspaceSelect } from './components/WorkspaceSelect';
export { CreateWorkspaceModal } from './components/Modals/CreateWorkspaceModal';
export { CreateWorkspaceStep1 } from './components/Modals/CreateWorkspaceModal/CreateWorkspaceStep1';
export { CreateWorkspaceStep2 } from './components/Modals/CreateWorkspaceModal/CreateWorkspaceStep2';
export { CreateTemplateModal } from './components/Modals/CreateTemplateModal';
export { CreateTemplateStep1 } from './components/Modals/CreateTemplateModal/CreateTemplateStep1';
export { CreateTemplateStep2 } from './components/Modals/CreateTemplateModal/CreateTemplateStep2';
export { WorkspaceSettingsModal } from './components/Modals/WorkspaceSettingsModal';
export { StepIndicator } from './components/StepIndicator';
export { UploadProgress } from './components/UploadProgress';
export { ShareWorkspaceDialog } from './components/ShareWorkspaceDialog';
export { useShareNotifications } from './hooks/useShareNotifications';
