# Workspace Module (Frontend)

The workspace module provides comprehensive workspace and document management, enabling users to create workspaces, upload documents, and configure AI settings for document processing.

## Table of Contents
 
- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [API Layer](#api-layer)
- [State Management](#state-management)
- [Selector Hooks](#selector-hooks)
- [Components](#components)
- [Testing](#testing)
- [Upload System](#upload-system)
- [Responsive Design](#responsive-design)
- [Usage Examples](#usage-examples)

---

## Overview

The workspace module provides:

- **Workspace Management**: Create, rename, delete workspaces with storage quotas
- **Document Management**: Upload, download, delete documents with bulk operations
- **Settings Configuration**: Custom AI settings with templates and RAG options
- **Dual Upload Strategy**: Direct upload for small files, presigned URLs for large files
- **Pagination Caching**: Map-based caching for workspaces and documents
- **Multi-Select**: Document selection with floating action bar for bulk operations
- **Responsive Design**: Mobile-first design with collapsible sidebar

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        WORKSPACE MODULE (Frontend)                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                              UI LAYER                                       │ │
│  │                                                                             │ │
│  │   WorkspaceButton        WorkspaceModal         CreateWorkspaceModal       │ │
│  │        │                      │                         │                   │ │
│  │        ▼                      ▼                         ▼                   │ │
│  │  Opens Modal    ┌─────────────────────────┐     2-Step Wizard              │ │
│  │                 │  Sidebar  │   Content   │     - Step 1: Name, Desc       │ │
│  │                 │           │             │     - Step 2: Settings Mode    │ │
│  │                 │  List of  │  Documents  │                                 │ │
│  │                 │  Spaces   │  Table      │     CreateTemplateModal        │ │
│  │                 │           │             │     WorkspaceSettingsModal     │ │
│  │                 └─────────────────────────┘                                 │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                                      ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                          ZUSTAND STORE                                      │ │
│  │                                                                             │ │
│  │  Workspaces Cache:  Map<page, Workspace[]>                                 │ │
│  │  Documents Cache:   Map<page, WorkspaceDocument[]>                         │ │
│  │  Upload Queue:      UploadQueueItem[]                                      │ │
│  │                                                                             │ │
│  │  Actions: fetchWorkspaces, selectWorkspace, createWorkspace,               │ │
│  │           fetchDocuments, deleteDocument, bulkDeleteDocuments,             │ │
│  │           startUpload, addFilesToQueue, updateUploadProgress               │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                                      ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                           API LAYER                                         │ │
│  │                                                                             │ │
│  │  Workspaces:  getWorkspaces, createWorkspace, updateWorkspace, delete      │ │
│  │  Documents:   getDocuments, deleteDocument, bulkDelete, getDownloadUrl     │ │
│  │  Settings:    getWorkspaceSettings, getTemplates, createSetting, update    │ │
│  │  Uploads:     uploadSmallFile, initiateBulkUpload, uploadToAzure,         │ │
│  │               completeBulkUpload                                           │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                                      ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                         BACKEND APIs                                        │ │
│  │                                                                             │ │
│  │  /workspaces              /workspaces/:id/documents                        │ │
│  │  /workspace-settings      /workspaces/:id/documents/upload                 │ │
│  │  /workspace-settings/templates  Azure Blob Storage (presigned URLs)        │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework with hooks |
| **Zustand** | State management with devtools |
| **TypeScript** | Type-safe development |
| **React Hook Form** | Form state management |
| **Zod** | Schema validation |
| **Lucide React** | Icons |
| **Radix UI** | Accessible UI primitives (Dialog, ScrollArea, Switch, Slider) |
| **Sonner** | Toast notifications |

---

## Directory Structure

```
workspace/
├── index.ts              # Public exports
├── types.ts              # TypeScript interfaces
├── api.ts                # API functions (workspace, documents, settings, uploads)
├── store.ts              # Zustand store with pagination caching
├── store.test.ts         # Store unit tests
├── utils.ts              # Constants and utility functions
├── utils.test.ts         # Utility unit tests
├── hooks/
│   ├── index.ts          # Hook exports
│   ├── useDocumentSelection.ts       # Multi-select hook
│   ├── useDocumentSelection.test.tsx # Multi-select hook tests
│   ├── useDebouncedSearch.ts         # Debounced search hook
│   ├── useDebouncedSearch.test.tsx   # Debounced search tests
│   ├── useModalCloseEffect.ts        # Modal close reset hook
│   └── useModalCloseEffect.test.tsx  # Modal close reset tests
├── components/
│   ├── index.ts          # Component exports
│   ├── WorkspaceButton.tsx      # Sidebar trigger button
│   ├── WorkspaceButton.test.tsx # Workspace button interaction tests
│   ├── WorkspaceModal.tsx       # Main modal container
│   ├── WorkspaceSidebar.tsx     # Workspace list with pagination
│   ├── WorkspaceItem.tsx        # Single workspace row
│   ├── WorkspaceContent.tsx     # Document area with actions
│   ├── DocumentsTable.tsx       # Documents table with pagination
│   ├── DocumentRow.tsx          # Single document row
│   ├── FloatingActionBar.tsx    # Bulk actions for selected docs
│   ├── CreateWorkspaceModal.tsx # 2-step workspace creation wizard
│   ├── CreateWorkspaceStep1.tsx # Name, description input
│   ├── CreateWorkspaceStep2.tsx # Settings mode selection
│   ├── CreateTemplateModal.tsx  # Template creation wizard
│   ├── CreateTemplateStep1.tsx  # Template name, description
│   ├── CreateTemplateStep2.tsx  # Template settings configuration
│   ├── WorkspaceSettingsModal.tsx # View/edit workspace settings
│   ├── StepIndicator.tsx        # Progress indicator for wizards
│   ├── UploadDropZone.tsx       # Drag-and-drop upload area
│   ├── UploadButton.tsx         # Click-to-upload button
│   └── UploadProgress.tsx       # Upload queue with progress bars
└── README.md             # This documentation
```

---

## Testing

### Coverage Scope

- `store.ts`: workspace fetch/cache behavior and workspace selection/change transitions
- `utils.ts`: formatting and file validation rules
- `hooks/*`: selection, debounced search, modal-close reset, store translator, document action/indexing hooks
- `components/*`: workspace list/content/table rows, upload widgets, floating actions, dialogs, and status badges
- `components/Modals/*`: workspace manager modal, create-workspace/create-template flows, workspace settings sub-sections
- `components/**`: co-located unit tests for all workspace component files (`*.tsx`) in the module

### Test Location

- Tests are co-located next to source files:
  - `src/modules/workspace/*.test.ts`
  - `src/modules/workspace/hooks/*.test.tsx`
  - `src/modules/workspace/components/**/*.test.tsx`

### Run Workspace Tests

```bash
npm run test -- src/modules/workspace
```

### Isolation Rules

- Tests are independent (no shared state between tests)
- Zustand store state and mocks are reset between tests
- API calls are mocked; no real network requests

---

## Types

### Workspace

```typescript
interface Workspace {
  id: string;
  name: string;
  alias: string;
  description?: string;
  createdBy: string;
  settings?: string;           // Reference to WorkspaceSetting ID
  documentCount: number;
  usedStorage: number;         // Bytes used
  allocatedStorage: number;    // Bytes allocated
  createdAt: string;
  updatedAt: string;
}
```

### WorkspaceDocument

```typescript
type DocumentStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';

interface WorkspaceDocument {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  url?: string;
  contentHash?: string;
  workspaceId: string;
  createdBy: string;
  status: DocumentStatus;
  uploadedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
```

### WorkspaceSetting

```typescript
type RagType = 'standard' | 'advancedRag' | 'smartRag';

interface WorkspaceSetting {
  id: string;
  name: string;
  description?: string;
  tag?: string;
  model?: string;
  isTemplate: boolean;         // Available as template for other workspaces
  isPredefined: boolean;       // Admin-created, read-only for users
  createdBy: string;
  instruction?: string;        // System prompt for AI
  chunks: number;              // Document chunks to retrieve (1-100)
  hybridSearch: boolean;       // Combine semantic + keyword search
  ragType: RagType;
  maxToken: number;            // Max tokens (100-128000)
  topK: number;                // Top K results (1-100)
  createdAt: string;
  updatedAt: string;
}
```

### Upload Types

```typescript
type UploadFileStatus = 'pending' | 'uploading' | 'completed' | 'failed';
type UploadSessionStatus = 'pending' | 'uploading' | 'completing' | 'completed' | 'failed';

interface UploadQueueItem {
  id: string;              // Local unique ID
  file: File;
  workspaceId: string;
  status: UploadFileStatus;
  progress: number;        // 0-100
  error?: string;
  documentId?: string;     // Set after backend creates record
  uploadUrl?: string;      // For presigned URL uploads
}

interface BulkUploadSession {
  sessionId: string;
  workspaceId: string;
  status: UploadSessionStatus;
  files: BulkUploadFileInfo[];
  totalFiles: number;
  totalSize: number;
  completedFiles: number;
  failedFiles: number;
  expiresAt: string;
  createdAt: string;
}
```

---

## API Layer

### Workspace APIs

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getWorkspaces(params)` | GET | `/workspaces` | List workspaces with pagination |
| `getWorkspace(id)` | GET | `/workspaces/:id` | Get single workspace |
| `getWorkspaceByAlias(alias)` | GET | `/workspaces/alias/:alias` | Get by alias |
| `createWorkspace(data)` | POST | `/workspaces` | Create workspace |
| `updateWorkspace(id, data)` | PATCH | `/workspaces/:id` | Update workspace |
| `deleteWorkspace(id)` | DELETE | `/workspaces/:id` | Delete workspace |

### Document APIs

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getDocuments(workspaceId, params)` | GET | `/workspaces/:id/documents` | List documents |
| `getDocument(workspaceId, docId)` | GET | `/workspaces/:id/documents/:docId` | Get document |
| `deleteDocument(workspaceId, docId)` | DELETE | `/workspaces/:id/documents/:docId` | Delete document |
| `bulkDeleteDocuments(workspaceId, ids)` | DELETE | `/workspaces/:id/documents/bulk` | Bulk delete |
| `deleteAllDocuments(workspaceId)` | DELETE | `/workspaces/:id/documents` | Delete all |
| `getDocumentDownloadUrl(workspaceId, docId)` | GET | `/workspaces/:id/documents/:docId/download` | Get download URL |

### Settings APIs

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getWorkspaceSettings(params)` | GET | `/workspace-settings` | List user's settings |
| `getWorkspaceSettingTemplates(params)` | GET | `/workspace-settings/templates` | List templates |
| `getWorkspaceSetting(id)` | GET | `/workspace-settings/:id` | Get setting |
| `createWorkspaceSetting(data)` | POST | `/workspace-settings` | Create setting |
| `updateWorkspaceSetting(id, data)` | PATCH | `/workspace-settings/:id` | Update setting |
| `deleteWorkspaceSetting(id)` | DELETE | `/workspace-settings/:id` | Delete setting |

### Upload APIs

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `uploadSmallFile(workspaceId, file, onProgress)` | POST | `/workspaces/:id/documents/upload` | Direct multipart upload |
| `requestUploadUrl(workspaceId, request)` | POST | `/workspaces/:id/documents/upload-url` | Get presigned URL |
| `confirmUpload(workspaceId, documentId)` | POST | `/workspaces/:id/documents/confirm` | Confirm upload complete |
| `initiateBulkUpload(workspaceId, request)` | POST | `/workspaces/:id/documents/bulk` | Start bulk session |
| `completeBulkUpload(workspaceId, sessionId)` | POST | `/workspaces/:id/documents/bulk/:sessionId/complete` | Complete session |
| `uploadToAzure(uploadUrl, file, onProgress)` | PUT | Azure Blob Storage | Direct Azure upload |

---

## State Management

### Zustand Store Structure

```typescript
interface WorkspaceState {
  // Workspace pagination cache
  workspaces: Map<number, Workspace[]>;
  currentPage: number;
  totalPages: number;
  totalWorkspaces: number;
  searchQuery: string;

  // Selected workspace
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | null;

  // Documents pagination cache
  documents: Map<number, WorkspaceDocument[]>;
  documentsCurrentPage: number;
  documentsTotalPages: number;
  totalDocuments: number;
  documentSearchQuery: string;

  // Templates
  templates: WorkspaceSetting[];

  // Settings modal state (independent from selected workspace)
  settingsTargetWorkspace: Workspace | null;
  currentWorkspaceSettings: WorkspaceSetting | null;
  isLoadingSettings: boolean;
  isSavingSettings: boolean;

  // UI State
  isModalOpen: boolean;
  isCreateModalOpen: boolean;
  isCreateTemplateModalOpen: boolean;
  isSettingsModalOpen: boolean;
  createModalStep: 1 | 2;
  createTemplateModalStep: 1 | 2;
  isMobileSidebarOpen: boolean;

  // Loading states
  isLoadingWorkspaces: boolean;
  isLoadingDocuments: boolean;
  isLoadingTemplates: boolean;
  isCreating: boolean;
  isDeleting: boolean;

  // Upload state
  uploadQueue: UploadQueueItem[];
  isUploading: boolean;
  uploadSessionId: string | null;

  // Error state
  error: string | null;
}
```

### Pagination Caching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                   MAP-BASED PAGINATION CACHE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  workspaces: Map<number, Workspace[]>                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Page 1 → [Workspace A, Workspace B, Workspace C, ...]  │   │
│  │  Page 2 → [Workspace D, Workspace E, Workspace F, ...]  │   │
│  │  Page 3 → [Workspace G, Workspace H, ...]               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Benefits:                                                       │
│  - No redundant API calls for visited pages                     │
│  - Instant navigation between cached pages                      │
│  - Cache cleared on search to ensure fresh results              │
│                                                                  │
│  Cache Invalidation:                                             │
│  - On search: Clear entire cache                                │
│  - On create/delete: Clear cache and refetch page 1            │
│  - On update: Update item in cache without refetch              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Selector Hooks

Optimized hooks for accessing store state:

| Hook | Returns | Description |
|------|---------|-------------|
| `useWorkspaces()` | `Workspace[]` | Current page workspaces |
| `useDocuments()` | `WorkspaceDocument[]` | Current page documents |
| `useSelectedWorkspace()` | `Workspace \| null` | Currently selected workspace |
| `useCurrentWorkspaceSettings()` | `WorkspaceSetting \| null` | Settings for target workspace |
| `useSettingsTargetWorkspace()` | `Workspace \| null` | Workspace being configured |
| `useWorkspaceModalState()` | `object` | All modal open/close states |
| `useWorkspaceLoading()` | `object` | All loading states |
| `useWorkspacePagination()` | `object` | Workspace pagination info |
| `useDocumentPagination()` | `object` | Document pagination info |
| `useUploadQueue()` | `UploadQueueItem[]` | Current upload queue |
| `useUploadState()` | `object` | Upload queue + isUploading + sessionId |
| `useHasActiveUploads()` | `boolean` | True if uploads in progress |

### useDocumentSelection Hook

Manages multi-selection state for documents:

```typescript
const {
  selectedIds,           // Set<string> - Selected document IDs
  selectedCount,         // number - Count of selected
  isAllSelected,         // boolean - All documents selected
  isSomeSelected,        // boolean - Some but not all selected
  isSelected,            // (id: string) => boolean
  toggleSelect,          // (id: string) => void
  toggleSelectAll,       // () => void
  clearSelection,        // () => void
  getSelectedDocuments,  // () => WorkspaceDocument[]
  getSelectedIds,        // () => string[]
} = useDocumentSelection(documents);
```

---

## Components

### WorkspaceModal

Main modal container with responsive sidebar/content layout.

```
┌─────────────────────────────────────────────────────────────────┐
│                       WORKSPACE MODAL                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌─────────────────────────────────────────┐ │
│  │   SIDEBAR     │  │              CONTENT                     │ │
│  │               │  │                                          │ │
│  │  [Search...]  │  │  Workspace Name           [Upload] [⋯]  │ │
│  │               │  │  5 docs · 12MB / 1GB                     │ │
│  │  [+ New]      │  │  ████████░░░░░░░░░░░░░░░░ Storage       │ │
│  │  ──────────   │  │                                          │ │
│  │  ○ Space A    │  │  [Search documents...]                   │ │
│  │  ● Space B ◄  │  │  ─────────────────────────────────────  │ │
│  │  ○ Space C    │  │  ☐ Name        Size   Type   Uploaded   │ │
│  │  ○ Space D    │  │  ☐ report.pdf  2.5MB  PDF    Jan 15     │ │
│  │               │  │  ☐ data.xlsx   1.2MB  XLSX   Jan 14     │ │
│  │  ──────────   │  │  ☐ notes.md    45KB   MD     Jan 13     │ │
│  │  < 1 / 3 >    │  │                                          │ │
│  └───────────────┘  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Responsive Behavior:**
- Mobile: Sidebar fills screen, toggleable
- Desktop: Side-by-side layout

---

### CreateWorkspaceModal

2-step wizard for workspace creation.

**Step 1: Basic Info**
- Name (required)
- Description (optional)

**Step 2: Settings Mode**
Three modes with clear UX:

| Mode | Description |
|------|-------------|
| **Default Settings** | No custom config, uses system defaults |
| **Use Template** | Select and apply a template (shows preview) |
| **Custom Settings** | Manual configuration (can pre-fill from template) |

**Custom Settings Form:**
- Model selection (grouped by provider)
- System instruction
- Chunks (1-100 slider)
- Hybrid search toggle
- RAG type (Standard, Advanced, Smart)
- Max tokens (100-128000)
- Top K (1-100)

---

### FloatingActionBar

Appears when documents are selected for bulk operations.

```
┌─────────────────────────────────────────────────────────────────┐
│        3 selected  │  [Download]  [Delete]  [×]                 │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Download selected documents (sequential with delay)
- Bulk delete with confirmation
- Clear selection

---

### UploadProgress

Fixed floating panel showing upload queue status.

```
┌─────────────────────────────────────────────────────────────────┐
│  🔄 Uploading 3 files                              [▼] [Clear]  │
├─────────────────────────────────────────────────────────────────┤
│  ████████████████████████████░░░░░░░░░░░░░░░░░  75%             │
├─────────────────────────────────────────────────────────────────┤
│  🔄 report.pdf        2.5MB   ████████░░ 80%                   │
│  ⏳ data.xlsx         1.2MB   Pending                          │
│  ✓  notes.md          45KB    Complete                    [×]  │
└─────────────────────────────────────────────────────────────────┘
```

**Status Icons:**
- ⏳ Clock - Pending
- 🔄 Spinner - Uploading
- ✓ Green check - Completed
- ✗ Red X - Failed

---

### UploadDropZone

Invisible wrapper that shows overlay when files are dragged.

**Features:**
- Full-screen overlay on drag
- File validation on drop
- Automatic upload start
- Supported formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV, MD, JSON

---

## Upload System

### Dual Upload Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                     UPLOAD STRATEGY FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Files Selected                                                  │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  validateFiles()                                          │   │
│  │  - Check MIME types (ALLOWED_MIME_TYPES)                 │   │
│  │  - Check size (< 500MB each)                             │   │
│  │  - Check count (≤ 50 files)                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│       │                                                          │
│       ▼                                                          │
│  Single file < 10MB?                                            │
│       │                                                          │
│   YES │                    NO                                    │
│       ▼                     │                                    │
│  ┌─────────────┐           │                                    │
│  │   DIRECT    │           ▼                                    │
│  │   UPLOAD    │      ┌────────────────────────────────────┐   │
│  │             │      │         BULK UPLOAD                 │   │
│  │ uploadSmall │      │                                     │   │
│  │ File()      │      │  1. initiateBulkUpload()           │   │
│  │             │      │     → Creates session + doc records │   │
│  │ multipart/  │      │     → Returns presigned URLs       │   │
│  │ form-data   │      │                                     │   │
│  └─────────────┘      │  2. uploadToAzure() (parallel)     │   │
│                       │     → Direct PUT to Azure Blob      │   │
│                       │     → Progress tracking via XHR     │   │
│                       │                                     │   │
│                       │  3. completeBulkUpload()           │   │
│                       │     → Backend verifies blobs exist │   │
│                       │     → Marks documents completed    │   │
│                       └────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Upload Constants

```typescript
// Allowed MIME types
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
];

// Size limits
const MAX_FILE_SIZE = 500 * 1024 * 1024;        // 500MB
const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024;  // 10MB
const MAX_FILES_PER_UPLOAD = 50;

// Pagination
const DEFAULT_PAGE_LIMIT = 10;
```

---

## Responsive Design

### Breakpoints

| Screen | Sidebar | Content | Table Columns |
|--------|---------|---------|---------------|
| Mobile (< md) | Full-width, toggleable | Hidden when sidebar open | Name only |
| Tablet (md-lg) | Fixed 256px | Fills remaining | Name, Size, Type |
| Desktop (lg+) | Fixed 256px | Fills remaining | All columns |

### Mobile Patterns

```typescript
// Toggle sidebar visibility
const { isMobileSidebarOpen } = useWorkspaceModalState();
const toggleMobileSidebar = useWorkspaceStore((state) => state.toggleMobileSidebar);

// Auto-close sidebar on workspace selection (mobile)
selectWorkspace: async (workspaceId) => {
  set({ isMobileSidebarOpen: false });
  // ...
}
```

---

## Usage Examples

### Opening Workspace Modal

```tsx
import { useWorkspaceStore, WorkspaceModal } from '@/modules/workspace';

function Header() {
  const openModal = useWorkspaceStore((state) => state.openModal);

  return (
    <>
      <Button onClick={openModal}>Manage Workspaces</Button>
      <WorkspaceModal />
    </>
  );
}
```

### Creating a Workspace

```tsx
import { useWorkspaceStore } from '@/modules/workspace';

function CreateButton() {
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);

  const handleCreate = async () => {
    const workspace = await createWorkspace({
      name: 'My Project',
      description: 'Documents for my project',
      settings: 'template-id-123', // optional
    });
    console.log('Created:', workspace.id);
  };

  return <Button onClick={handleCreate}>Create</Button>;
}
```

### Uploading Documents

```tsx
import { useWorkspaceStore, useSelectedWorkspace, validateFiles } from '@/modules/workspace';

function UploadHandler() {
  const selectedWorkspace = useSelectedWorkspace();
  const addFilesToQueue = useWorkspaceStore((state) => state.addFilesToQueue);
  const startUpload = useWorkspaceStore((state) => state.startUpload);

  const handleFiles = (files: FileList) => {
    if (!selectedWorkspace) return;

    const { validFiles } = validateFiles(Array.from(files));
    if (validFiles.length === 0) return;

    addFilesToQueue(validFiles, selectedWorkspace.id);
    startUpload();
  };

  return (
    <input
      type="file"
      multiple
      accept={ACCEPT_EXTENSIONS}
      onChange={(e) => e.target.files && handleFiles(e.target.files)}
    />
  );
}
```

### Bulk Delete with Selection

```tsx
import { useDocumentSelection, useDocuments, useWorkspaceStore } from '@/modules/workspace';

function DocumentList() {
  const documents = useDocuments();
  const selectedWorkspace = useSelectedWorkspace();
  const bulkDeleteDocuments = useWorkspaceStore((state) => state.bulkDeleteDocuments);

  const {
    selectedCount,
    getSelectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    isAllSelected,
  } = useDocumentSelection(documents);

  const handleBulkDelete = async () => {
    if (!selectedWorkspace) return;
    const result = await bulkDeleteDocuments(selectedWorkspace.id, getSelectedIds());
    clearSelection();
    console.log(`Deleted: ${result.deleted}, Failed: ${result.failed.length}`);
  };

  return (
    <div>
      <Checkbox checked={isAllSelected} onChange={toggleSelectAll} />
      {documents.map((doc) => (
        <DocumentRow
          key={doc.id}
          document={doc}
          onSelect={() => toggleSelect(doc.id)}
        />
      ))}
      {selectedCount > 0 && (
        <FloatingActionBar
          selectedCount={selectedCount}
          selectedIds={getSelectedIds()}
          onClearSelection={clearSelection}
        />
      )}
    </div>
  );
}
```

### Clearing Workspace Settings

```tsx
import { useWorkspaceStore } from '@/modules/workspace';

function SettingsPanel() {
  const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);

  // Send null to clear settings (not undefined)
  const clearSettings = async (workspaceId: string) => {
    await updateWorkspace(workspaceId, { settings: null });
  };

  return <Button onClick={() => clearSettings('ws-123')}>Use Defaults</Button>;
}
```

---

## Predefined Templates

Templates marked as `isPredefined: true` by admins:

- **Read-only** for regular users (403 on update/delete)
- **Sorted first** in template lists
- **Star icon** (★) in dropdowns
- Can be **copied from** when creating new templates

```tsx
// Template dropdown with predefined indicator
{templates.map((template) => (
  <SelectItem key={template.id} value={template.id}>
    <div className="flex items-center gap-2">
      {template.isPredefined && (
        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
      )}
      <span>{template.name}</span>
    </div>
  </SelectItem>
))}
```

---

## Utility Functions

```typescript
import {
  formatFileSize,
  formatDate,
  getFileTypeLabel,
  validateFiles,
} from '@/modules/workspace';

// Format bytes to human-readable
formatFileSize(1536000);  // "1.5 MB"

// Format date to localized short format
formatDate('2024-01-15T10:30:00Z');  // "Jan 15, 2024"

// Get file type label from MIME
getFileTypeLabel('application/pdf');  // "PDF"
getFileTypeLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document');  // "DOCX"

// Validate files for upload
const { validFiles, errors } = validateFiles(files);
// Shows toast for rejected files
```
