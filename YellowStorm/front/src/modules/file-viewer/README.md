# File Viewer Module (Frontend)

The file viewer module provides a floating, draggable, resizable window for previewing files directly within the application. It supports multiple file types through a pluggable renderer architecture, with tabbed navigation for viewing several files simultaneously.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [State Management](#state-management)
- [Selector Hooks](#selector-hooks)
- [Components](#components)
- [Renderers](#renderers)
- [Hooks](#hooks)
- [Public API](#public-api)
- [Usage Examples](#usage-examples)
- [Supported File Types](#supported-file-types)
- [CORS Considerations](#cors-considerations)
- [Adding a New Renderer](#adding-a-new-renderer)

---

## Overview

The file viewer module provides:

- **Floating Window**: Draggable, resizable window with 8 edge/corner resize handles
- **Sidebar Mode**: Right-panel container with resize handle, used when viewing files from conversation context
- **Multi-Tab Support**: Open multiple files in tabs, switch between them without reloading
- **Minimize/Restore**: Minimize to a draggable pill, restore without reloading content
- **Three Viewer Modes**: `open`, `minimized`, `closed`
- **Two Display Modes**: `floating` (default window) or `sidebar` (right panel)
- **Pluggable Renderers**: PDF, DOCX, PPTX, spreadsheet, image, text/code renderers with fallback for unsupported types
- **Two Open Methods**: Open workspace documents (via backend API) or arbitrary URLs (for artifacts)
- **Presigned URL Management**: Automatic expiry detection and refresh for workspace documents
- **PDF Navigation**: Scroll to a specific page and highlight/search text after load
- **Excel Navigation**: Select sheets, jump to specific rows, and highlight spreadsheet data
- **PPTX Controls**: Slide navigation, fullscreen mode, search, and download
- **Theme Integration**: PDF viewer maps to app's CSS custom properties into its shadow DOM
- **Viewport Clamping**: Window and minimized pill reposition when browser is resized
- **Syntax Highlighting**: 40+ languages via shiki with light/dark theme support
- **Image Controls**: Zoom (scroll wheel + buttons), pan (click-drag), checkerboard transparency

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FILE VIEWER MODULE (Frontend)               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                           UI LAYER                               │ │
│  │                                                                    │ │
│  │  FileFloatingWindow (floating) / FileViewerSidebar (sidebar)      │ │
│  │         │             ──▶ FileViewerContent  (tab bar + renderers)      │ │
│  │         │                       │                                       │ │
│  │         │                       ▼                                       │ │
│  │         │              ┌──────────────────┐                            │ │
│  │         │              │  Renderer Layer  │                            │ │
│  │         │              │                  │                            │ │
│  │         │              │  PdfRenderer     │  @embedpdf/react-pdf-viewer  │ │
│  │         │              │  DocxRenderer    │  @cyntler/react-doc-viewer  │ │
│  │         │              │  SpreadsheetRenderer │ exceljs + sheet navigation│ │
│  │         │              │  PptxRenderer    │  pptx-to-html w/ controls  │ │
│  │         │              │  TextRenderer    │  shiki syntax highlighting │ │
│  │         │              │  ImageRenderer   │  zoom / pan / checkerboard │ │
│  │         │              │  Unsupported     │  fallback message          │ │
│  │         │              └──────────────────┘                            │ │
│  │         │                                                               │ │
│  │         └──▶ FileMinimizedWindow (draggable pill when minimized)       │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                         ZUSTAND STORE                           │ │
│  │                                                                    │ │
│  │  State:                              Actions:                           │ │
│  │  ├─ mode: ViewerMode                ├─ openFile(workspace doc)         │ │
│  │  ├─ displayMode: DisplayMode       ├─ openFileFromUrl(direct URL)     │ │
│  │  ├─ tabs: FileTab[]                 ├─ closeTab(tabId)                 │ │
│  │  ├─ activeTabId: string | null      ├─ setActiveTab(tabId)             │ │
│  │  ├─ position: WindowPosition        ├─ minimize() / restore()          │ │
│  │  ├─ size: WindowSize                ├─ closeViewer()                   │ │
│  │  ├─ minimizedPosition               ├─ setPosition() / setSize()       │ │
│  │  └─ pendingNavigation               ├─ setDisplayMode()                  │ │
│  │                                      └─ refreshTabUrl(tabId)            │ │
│  │                                      └─ switchToFloating() / switchToSidebar() │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                         BACKEND API                              │ │
│  │                                                                    │ │
│  │  GET /workspaces/:id/documents/:docId/download-url                     │ │
│  │  POST /conversations/artifact-url                                       │ │
│  │  ──▶ Returns presigned Azure Blob Storage SAS URL                      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology                     | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| **React 18**                   | UI framework with hooks                   |
| **Zustand**                    | State management with devtools middleware |
| **TypeScript**                 | Type-safe development                     |
| **@embedpdf/react-pdf-viewer** | PDF rendering with plugin architecture    |
| **@cyntler/react-doc-viewer**   | DOCX rendering                              |
| **exceljs**                    | Spreadsheet parsing + sheet navigation    |
| **shiki**                      | Syntax highlighting for 40+ languages     |
| **Lucide React**               | Icons                                     |
| **Sonner**                     | Toast notifications for errors            |
| **Tailwind CSS**               | Styling with dark mode support            |

---

## Directory Structure

```
file-viewer/
├── index.ts                    # Public API: openFileViewer, openFileViewerFromUrl, etc.
├── types.ts                    # TypeScript interfaces (FileTab, ViewerMode, etc.)
├── store.ts                    # Zustand store with devtools
├── hooks/
│   ├── index.ts                # Hook exports
│   ├── useDraggable.ts         # Pointer-event-based drag with setPointerCapture
│   └── useResizable.ts         # 8-handle resize with min size constraints
├── components/
│   ├── index.ts                # Component exports
│   ├── FileFloatingWindow.tsx  # Top-level: mode routing, resize handles, viewport clamping
│   ├── FileViewerSidebar.tsx   # Sidebar mode container with title bar and resize handle
│   ├── FileWindowTitleBar.tsx  # Drag handle + minimize/close buttons
│   ├── FileMinimizedWindow.tsx # Draggable pill shown when minimized
│   └── FileViewerContent.tsx   # Tab bar + renderer instances (all mounted, active visible)
├── renderers/
│   ├── index.ts                # Renderer registry: getRenderer(), isViewableFile(), etc.
│   ├── DocxRenderer/            # DOCX rendering via @cyntler/react-doc-viewer
│   ├── SpreadsheetRenderer/    # Spreadsheet rendering via exceljs with sheet/row controls
│   ├── ImageRenderer.tsx       # Image with zoom, pan, checkerboard background
│   ├── PdfRenderer/            # PDF rendering with theme mapping and navigation
│   ├── PptxRenderer/           # PowerPoint renderer + assets with controls
│   ├── TextRenderer.tsx        # Text/code with shiki syntax highlighting
│   └── UnsupportedRenderer.tsx # Fallback for unknown MIME types
├── utils/
│   ├── excel.ts                 # Excel type definitions and utilities
│   ├── pptx.ts                  # PPTX type definitions and utilities
│   └── pdf/                     # PDF-specific utilities
├── locales/
│   ├── en.json                 # English translations
│   └── fr.json                 # French translations
└── README.md                   # This documentation
```

---

## Types

### FileTab

Represents a single open file tab in the viewer.

```typescript
interface FileTab {
  id: string;
  workspaceId?: string;
  documentId?: string;
  fileName: string;
  mimeType: string;
  url: string;
  urlExpiresAt?: string;
  isLoading?: boolean;
}
```

- **Workspace documents** have `workspaceId`, `documentId`, and `urlExpiresAt` set. Their tab ID is `${workspaceId}:${documentId}`.
- **URL-based files** (artifacts) omit these fields. Their tab ID is `url:${url}`.

### ViewerMode

```typescript
type ViewerMode = 'open' | 'minimized' | 'closed';
```

| Mode        | Behavior                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `open`      | Floating window is visible and interactive                                                                   |
| `minimized` | Window is hidden (`opacity-0 pointer-events-none`), pill is shown. Content stays mounted to avoid reloading. |
| `closed`    | Window and all tabs are unmounted, state is reset                                                            |

### DisplayMode

```typescript
type DisplayMode = 'floating' | 'sidebar';
```

| Mode       | Behavior                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `floating`  | Window is displayed as a draggable, resizable floating window                         |
| `sidebar`   | Viewer is rendered in a right panel container (used from conversation context)         |

### FileOpenOptions

Options for controlling navigation when opening a file (PDF and spreadsheets).

```typescript
interface FileOpenOptions {
  page?: number;
  highlightText?: string;
  displayMode?: DisplayMode;
  spreadsheet?: SpreadsheetNavigationOptions;
}

interface SpreadsheetNavigationOptions {
  sheetName?: string;
  sheetIndex?: number;
  focusRow?: number;
  highlightRow?: number;
}
```

### RendererProps

Interface that all renderer components receive.

```typescript
interface RendererProps {
  tab: FileTab;
  isActive: boolean;
  onReady?: () => void;
}
```

### Other Types

```typescript
interface PendingNavigation {
  tabId: string;
  page?: number;
  highlightText?: string;
  spreadsheet?: SpreadsheetNavigationOptions;
}

interface WindowPosition {
  x: number;
  y: number;
}

interface WindowSize {
  width: number;
  height: number;
}
```

---

## State Management

The module uses a Zustand store (`useFileViewerStore`) with devtools middleware (name: `'file-viewer-store'`).

### Constants

| Constant                      | Value  | Description                        |
| ----------------------------- | ------ | ---------------------------------- |
| `DEFAULT_WIDTH`               | 900    | Initial window width               |
| `DEFAULT_HEIGHT`              | 650    | Initial window height              |
| `MIN_WIDTH`                   | 480    | Minimum resize width               |
| `MIN_HEIGHT`                  | 360    | Minimum resize height              |
| `URL_EXPIRY_SAFETY_MARGIN_MS` | 60,000 | Refresh URL 1 minute before expiry |
| `SIDEBAR_DEFAULT_WIDTH`        | 768    | Default sidebar width (3xl)        |
| `SIDEBAR_MIN_WIDTH`            | 480    | Minimum sidebar width              |

### Actions

| Action                 | Signature                                                             | Description                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `openFile`             | `(workspaceId, docId, fileName, mimeType, options?) => Promise<void>` | Opens a workspace document. Fetches a presigned URL from the backend. Reuses existing tab if already open, refreshing URL if expired. |
| `openFileFromUrl`      | `(url, fileName, mimeType, options?) => void`                       | Opens a file directly from a URL (for artifacts, external files). Synchronous — no backend call needed.                                   |
| `closeTab`             | `(tabId) => void`                                                     | Closes a tab. If it was the last tab, closes the entire viewer.                                                                           |
| `setActiveTab`         | `(tabId) => void`                                                     | Switches to a different tab.                                                                                                              |
| `minimize`             | `() => void`                                                          | Sets mode to `minimized`.                                                                                                                 |
| `restore`              | `() => void`                                                          | Sets mode to `open`.                                                                                                                      |
| `closeViewer`          | `() => void`                                                          | Closes viewer and removes all tabs.                                                                                                   |
| `setPosition`          | `(pos) => void`                                                       | Updates window position (from drag).                                                                                                      |
| `setSize`              | `(size) => void`                                                      | Updates window size (from resize), enforcing min constraints.                                                                             |
| `setMinimizedPosition` | `(pos) => void`                                                       | Updates minimized pill position.                                                                                                          |
| `refreshTabUrl`        | `(tabId) => Promise<void>`                                            | Re-fetches the presigned URL for a workspace document tab. No-op for URL-based tabs.                                                      |
| `setDisplayMode`       | `(mode: DisplayMode) => void`                                           | Sets the display mode (floating or sidebar).                                                                                          |
| `switchToFloating`     | `() => void`                                                          | Switches from sidebar mode to floating window mode.                                                                                        |
| `switchToSidebar`      | `() => void`                                                          | Switches from floating mode to sidebar mode.                                                                                           |

---

## Selector Hooks

Fine-grained selector hooks for minimal re-renders:

```typescript
useFileViewerMode(); // ViewerMode
useFileViewerDisplayMode(); // DisplayMode
useFileViewerTabs(); // FileTab[]
useFileViewerActiveTabId(); // string | null
useFileViewerPosition(); // WindowPosition
useFileViewerSize(); // WindowSize
useFileViewerMinimizedPosition(); // WindowPosition
useFileViewerPendingNavigation(); // PendingNavigation | null
```

---

## Components

### FileFloatingWindow

Top-level component. Renders nothing when `mode === 'closed'`. When open, renders a floating window with resize handles. When minimized, renders a pill and keeps the window mounted but invisible.

**Key behaviors:**

- Listens to `window.resize` events to clamp position/size within viewport
- Uses `opacity-0 pointer-events-none` (not `visibility: hidden`) when minimized, because PDF viewer's shadow DOM would override `visibility`
- Mounts 8 invisible resize handles around window edges and corners

**Mount point:** `App.tsx` — rendered as a global overlay.

### FileViewerSidebar

Right-panel container used when files are opened from a conversation context. Wraps `FileViewerContent` with its own title bar and resize handle.

**Key behaviors:**

- Animated open/close with smooth transitions
- Resizable via left-edge drag handle
- Shows maximize button when in sidebar mode
- Includes close button
- Default width: 768px (3xl), minimum 480px

### FileWindowTitleBar

Drag handle for the window. Displays the active tab's filename. Contains minimize and close buttons. Button area stops pointer propagation to prevent dragging when clicking buttons.

### FileMinimizedWindow

Draggable pill shown at minimized position. Shows the active filename, a tab count badge (when > 1 tab), and restore/close buttons.

### FileViewerContent

Manages the tab bar and renderer instances.

**Key behaviors:**

- Tab bar only appears when there are 2+ tabs
- **All tabs are mounted simultaneously** — inactive tabs are hidden with `invisible` CSS class. This prevents renderers from reloading when switching tabs.
- Uses `getRenderer(mimeType)` to pick the correct renderer component
- Falls back to `UnsupportedRenderer` when no renderer matches
- Shows a single loader when a tab's URL is being fetched

---

## Renderers

### Renderer Registry (`renderers/index.ts`)

Maps MIME types to renderer components and provides utility functions.

#### Functions

| Function                  | Signature                                 | Description                                     |
| ------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `getRenderer`             | `(mimeType: string) => Component \| null` | Returns the renderer for a MIME type, or `null` |
| `isViewableFile`          | `(mimeType: string) => boolean`           | Checks if a MIME type has a renderer            |
| `getMimeTypeFromFilename` | `(filename: string) => string \| null`    | Infers MIME type from file extension            |
| `isViewableFilename`      | `(filename: string) => boolean`           | Checks if a filename's extension is viewable    |

### DocxRenderer

Renders DOCX files using `@cyntler/react-doc-viewer`.

**Features:**

- **Native DOCX rendering**: Uses Microsoft Office Online viewer via iframe for rendering
- **Download button**: Floating button in top-right corner allows downloading the file
- **Header disabled**: The package's default header is hidden, replaced by our tab system
- **Loading override**: Custom empty loader component hides the package's internal loading state
- **Clean loading**: Loading state is managed at parent level (FileViewerContent), showing "Chargement de {fileName}..."

### PdfRenderer

Renders PDFs using `@embedpdf/react-pdf-viewer`.

**Features:**

- **Theme mapping**: Reads CSS custom properties (`--background`, `--foreground`, `--primary`, etc.) and converts them to hex via a canvas context. Maps them to EmbedPDF's `ThemeColors` structure.
- **Disabled categories**: `document-open`, `document-close`, `annotation`, `redaction`, `comment`, `panel-comment` — these menu items are removed from the PDF viewer toolbar.
- **Navigation**: On `onReady`, applies pending page scroll (`scrollToPage`) and text search (`searchAllPages`) via plugin registry's scroll and search capabilities.
- **Extended controls**: Registers EmbedPDF zoom/print/export plugins and surfaces them next to our page navigation (zoom in/out + live % readout, `Print`, `Download`).
- **In-document search**: A dedicated toolbar (auto-focused via `Cmd+F` / `Ctrl+F`) runs live `searchAllPages` queries, highlights matches through `SearchLayer`, and lets the user jump between results without leaving the modal.
- **Tab bar**: Set to `'never'` since the file viewer provides its own tab system.

### SpreadsheetRenderer

Renders Excel spreadsheets using `exceljs`.

**Features:**

- **Sheet selection**: Dropdown to switch between sheets
- **Row highlighting**: Navigate to a specific row with visual highlighting
- **Column types**: Detects string, number, and boolean columns
- **Fullscreen mode**: Expand to full viewport
- **Search**: Find text within the sheet
- **Download**: Export the original file

### PptxRenderer

Renders PowerPoint presentations using `pptx-to-html`.

**Features:**

- **Slide navigation**: Previous/next buttons, keyboard shortcuts (arrow keys)
- **Slide counter**: Shows current slide position
- **Fullscreen mode**: Toggle fullscreen presentation view
- **Search**: Find text across all slides
- **Download**: Export the original file
- **Asset loading**: Custom asset loader for PowerPoint icons (images, fonts, layout)

### TextRenderer

Renders text and code files with syntax highlighting.

**Features:**

- **Language detection**: Two-pass lookup — first by MIME type (`MIME_TO_LANGUAGE`), then by file extension (`EXT_TO_LANGUAGE`). Falls back to plain text with line numbers.
- **Dual-theme rendering**: Generates both light (`one-light`) and dark (`one-dark-pro`) HTML at load time. Uses `dark:hidden` / `hidden dark:block` CSS to swap.
- **Line numbers**: Custom shiki transformer prepends line number spans to each line.
- **Copy button**: Floating button in top-right copies raw text to clipboard.
- **Error handling**: Shows error UI with retry and close tab buttons.
- **Loading**: Fetches text content via `fetch(tab.url)`.

**Supported languages (40+):** JavaScript, TypeScript, Python, Rust, Go, Java, Kotlin, Swift, C, C++, C#, PHP, Ruby, Lua, R, Dart, SQL, GraphQL, Markdown, MDX, YAML, TOML, INI, JSON, JSONC, XML, HTML, CSS, SCSS, Sass, Less, Bash, Dockerfile, Makefile, Vue, Svelte, Astro, CSV, Log, and more.

### ImageRenderer

Renders images with interactive controls.

**Features:**

- **Zoom**: Scroll wheel or +/- buttons. Range: 10% to 1000%, step 25%.
- **Pan**: Click-and-drag with pointer capture for smooth movement.
- **Reset**: Button to reset zoom to 100% and center position.
- **Checkerboard background**: CSS gradient pattern for transparency visualization.
- **Loading spinner**: Overlay shown while image loads.
- **Error handling**: Shows error UI with retry and close tab buttons.
- **Native loading**: Uses `<img>` tag which bypasses CORS restrictions.

### UnsupportedRenderer

Simple fallback UI with a `FileQuestion` icon and message.

---

## Hooks

### useDraggable

Pointer-event-based drag hook with `setPointerCapture` for reliable tracking.

```typescript
const { dragHandleProps } = useDraggable({
  position: { x, y },
  onPositionChange: (pos) => void,
});

// Spread onto drag handle element
<div {...dragHandleProps}>Drag me</div>
```

**Behavior:**

- Only responds to left mouse button
- Clamps position to keep at least 100px visible horizontally and 40px vertically
- Sets `touch-action: none` and `cursor: grab`

### useResizable

8-handle resize hook with minimum size constraints.

```typescript
const { getResizeHandleProps } = useResizable({
  position, size, onPositionChange, onSizeChange,
});

// Render invisible handles on each edge/corner
{['n','s','e','w','ne','nw','se','sw'].map(edge => (
  <div key={edge} {...getResizeHandleProps(edge)} />
))}
```

**Behavior:**

- Corner handles: 12px square hit area
- Edge handles: 4px wide/tall strip
- Enforces minimum 480x360 window size
- Clamps position to viewport bounds
- Correct cursor for each edge direction

---

## Tests

The module includes comprehensive unit tests using Vitest and React Testing Library.

### Test Structure

```
file-viewer/
├── components/
│   ├── FileFloatingWindow.test.tsx
│   ├── FileMinimizedWindow.test.tsx
│   ├── FileViewerContent.test.tsx
│   ├── FileViewerSidebar.test.tsx
│   └── FileWindowTitleBar.test.tsx
├── renderers/
│   ├── DocxRenderer/index.test.tsx
│   ├── ImageRenderer.test.tsx
│   ├── PdfRenderer/
│   │   ├── components/
│   │   │   ├── HeadlessViewer.test.tsx
│   │   │   ├── HighlightOnLoad.test.tsx
│   │   │   ├── PendingNavigationEffect.test.tsx
│   │   │   ├── ScrollToPageOnLoad.test.tsx
│   │   │   ├── SearchControls.test.tsx
│   │   │   └── ViewerToolbar.test.tsx
│   │   ├── index.test.tsx
│   │   └── utils/text.test.ts
│   ├── PptxRenderer/
│   │   ├── asset-loader.test.ts
│   │   └── index.test.tsx
│   ├── SpreadsheetRenderer/index.test.tsx
│   ├── TextRenderer.test.tsx
│   ├── UnsupportedRenderer.test.tsx
│   └── index.test.ts
├── hooks/
│   ├── useDraggable.test.tsx
│   └── useResizable.test.tsx
├── utils/
│   ├── excel.test.ts
│   └── pptx.test.ts
└── store.test.ts
```

### Key Test Coverage

- **FileFloatingWindow**: Window state management, resize behavior, viewport clamping
- **FileViewerSidebar**: Sidebar mode, resize handle, close/maximize controls
- **FileViewerContent**: Tab rendering, tab switching, loader states
- **Renderers**: Each renderer's loading states, content rendering, and error handling
- **Hooks**: Drag and resize behavior validation
- **Store**: State updates, action dispatching, tab management
- **Utils**: Excel type detection, PPTX asset loading

### Running Tests

```bash
npm test -- file-viewer
```

---

## Public API

The module barrel (`index.ts`) exports everything needed for external use.

### Functions

```typescript
import {
  openFileViewer,
  openFileViewerFromUrl,
  isViewableFile,
  isViewableFilename,
  getMimeTypeFromFilename,
  FileFloatingWindow,
  FileViewerSidebar
} from '@/modules/file-viewer';
```

#### `openFileViewer(workspaceId, docId, fileName, mimeType, options?)`

Opens a workspace document in the floating viewer. Fetches a presigned download URL from the backend.

```typescript
// Open a PDF at page 5
openFileViewer(workspace.id, doc.id, doc.originalName, 'application/pdf', {
  page: 5,
});

// Open an Excel file at a specific sheet + row
openFileViewer(workspace.id, doc.id, doc.originalName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
  spreadsheet: {
    sheetName: 'KPIs',
    focusRow: 42,
    highlightRow: 42,
  },
});

// Open a DOCX file in sidebar mode
openFileViewer(workspace.id, doc.id, doc.originalName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', {
  displayMode: 'sidebar',
});
```

#### `openFileViewerFromUrl(url, fileName, mimeType, options?)`

Opens a file directly from a URL. Used for artifacts and other non-workspace files.

```typescript
// Open an artifact in the viewer
const { downloadUrl } = await getArtifactDownloadUrl(filePath, filename);
openFileViewerFromUrl(downloadUrl, filename, 'application/pdf');

// Open a DOCX file
const { downloadUrl } = await getArtifactDownloadUrl(filePath, filename);
openFileViewerFromUrl(downloadUrl, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
```

#### `isViewableFile(mimeType)`

Returns `true` if the MIME type has a registered renderer.

```typescript
if (isViewableFile(document.mimeType)) {
  // Show "View" button
}
```

#### `isViewableFilename(filename)`

Returns `true` if a file's extension maps to a viewable MIME type.

```typescript
if (isViewableFilename('report.pdf')) {
  // Show "View" button
}
```

#### `getMimeTypeFromFilename(filename)`

Returns the MIME type for a filename's extension, or `null` if unknown.

```typescript
getMimeTypeFromFilename('script.ts'); // 'text/typescript'
getMimeTypeFromFilename('photo.png'); // 'image/png'
getMimeTypeFromFilename('document.docx'); // 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
getMimeTypeFromFilename('presentation.pptx'); // 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
getMimeTypeFromFilename('data.xyz'); // null
```

### Components

```typescript
import { FileFloatingWindow, FileViewerSidebar } from '@/modules/file-viewer';
```

#### `FileFloatingWindow`

The top-level component. Mount once in `App.tsx` as a global overlay.

```tsx
function App() {
  return (
    <>
      <Router />
      <FileFloatingWindow />
    </>
  );
}
```

#### `FileViewerSidebar`

The sidebar mode component. Used when files need to be displayed in a right panel.

### Store

```typescript
import {
  useFileViewerStore,
  useFileViewerMode,
  useFileViewerDisplayMode,
} from '@/modules/file-viewer';
```

Direct store access for advanced use cases (reading state, subscribing to changes).

---

## Usage Examples

### Opening a workspace document

```typescript
import { openFileViewer, isViewableFile } from '@/modules/file-viewer';

function DocumentRow({ document, workspaceId }) {
  const isViewable = isViewableFile(document.mimeType);

  return (
    <div>
      <span>{document.originalName}</span>
      {isViewable && (
        <button onClick={() => openFileViewer(
          workspaceId,
          document.id,
          document.originalName,
          document.mimeType,
        )}>
          View
        </button>
      )}
    </div>
  );
}
```

### Opening an artifact from chat

```typescript
import { openFileViewerFromUrl, getMimeTypeFromFilename } from '@/modules/file-viewer';
import { getArtifactDownloadUrl } from '@/modules/conversation/api';

async function handleViewArtifact(filePath: string, filename: string) {
  const { downloadUrl } = await getArtifactDownloadUrl(filePath, filename);
  const mimeType = getMimeTypeFromFilename(filename) ?? 'application/octet-stream';
  openFileViewerFromUrl(downloadUrl, filename, mimeType);
}
```

### Opening a PDF at a specific page with search

```typescript
openFileViewer(workspaceId, docId, 'report.pdf', 'application/pdf', {
  page: 12,
  highlightText: 'revenue forecast',
});
```

### Programmatic store access

```typescript
import { useFileViewerStore } from '@/modules/file-viewer';

// Close all tabs
useFileViewerStore.getState().closeViewer();

// Check if viewer is open
const mode = useFileViewerStore.getState().mode; // 'open' | 'minimized' | 'closed'

// Get active tab info
const { tabs, activeTabId } = useFileViewerStore.getState();
const activeTab = tabs.find((t) => t.id === activeTabId);
```

---

## Supported File Types

### PDF

| MIME Type         | Renderer    |
| ----------------- | ----------- |
| `application/pdf` | PdfRenderer |

### Word (DOCX)

| MIME Type                                                                                              | Extensions        | Renderer       |
| ------------------------------------------------------------------------------------------------------- | ------------------- | -------------- |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx`, `.docm` | DocxRenderer |
| `application/vnd.ms-word.document.macroEnabled.12`                                      | `.doc`              | DocxRenderer |

### PowerPoint (PPTX)

| MIME Type                                                                                              | Extensions            | Renderer        |
| ------------------------------------------------------------------------------------------------------- | --------------------- | --------------- |
| `application/vnd.ms-powerpoint`                                                                      | `.ppt`               | PptxRenderer   |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `.pptx`              | PptxRenderer   |

### Spreadsheets

| MIME Type                                                                 | Extensions                      | Renderer       |
| ------------------------------------------------------------------------- | ------------------------------- | -------------- |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`       | `.xlsx`, `.xltx`                | SpreadsheetRenderer |
| `application/vnd.ms-excel`                                                | `.xls`                          | SpreadsheetRenderer |
| `application/vnd.ms-excel.sheet.macroEnabled.12`                          | `.xlsm`                         | SpreadsheetRenderer |
| `application/vnd.ms-excel.sheet.binary.macroEnabled.12`                   | `.xlsb`                         | SpreadsheetRenderer |
| `text/csv`                                                                  | `.csv`                          | SpreadsheetRenderer |

### Images

| MIME Type       | Extensions      | Renderer      |
| --------------- | --------------- | ------------- |
| `image/png`     | `.png`          | ImageRenderer |
| `image/jpeg`    | `.jpg`, `.jpeg` | ImageRenderer |
| `image/gif`     | `.gif`          | ImageRenderer |
| `image/webp`    | `.webp`         | ImageRenderer |
| `image/svg+xml` | `.svg`          | ImageRenderer |
| `image/bmp`     | `.bmp`          | ImageRenderer |
| `image/avif`    | `.avif`         | ImageRenderer |

### Text / Code

| MIME Type          | Extensions                                                                                                     | Syntax Highlighting           |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `text/plain`       | `.txt`, `.log`, `.sh`, `.bash`, `.sql`, `.toml`, `.ini`, `.env`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, and more | Yes (via extension detection) |
| `text/markdown`    | `.md`, `.mdx`                                                                                                  | Yes                           |
| `text/css`         | `.css`                                                                                                         | Yes                           |
| `text/html`        | `.html`, `.htm`                                                                                                | Yes                           |
| `text/xml`         | `.xml`                                                                                                         | Yes                           |
| `text/yaml`        | `.yaml`, `.yml`                                                                                                | Yes                           |
| `text/javascript`  | `.js`, `.jsx`, `.mjs`                                                                                          | Yes                           |
| `text/typescript`  | `.ts`, `.tsx`                                                                                                  | Yes                           |
| `text/x-python`    | `.py`                                                                                                          | Yes                           |
| `application/json` | `.json`, `.jsonc`                                                                                              | Yes                           |
| `application/xml`  | `.xml`                                                                                                         | Yes                           |

The TextRenderer uses a two-pass language detection: first by MIME type, then by file extension. Even files mapped to `text/plain` get syntax highlighting based on their extension (e.g., a `.rs` file is highlighted as Rust).

---

## CORS Considerations

File content is loaded from Azure Blob Storage presigned URLs. CORS behavior varies by renderer:

| Renderer          | Loading Method                               | CORS Subject? | Notes                             |
| ----------------- | -------------------------------------------- | ------------- | --------------------------------- |
| **PdfRenderer**   | `@embedpdf/react-pdf-viewer` internal loader | Yes           | Requires Azure CORS configuration |
| **DocxRenderer**  | Microsoft Office Online viewer (iframe)      | Yes           | Requires Azure CORS configuration |
| **PptxRenderer**   | `fetch(url).then(r => r.arrayBuffer())`      | Yes           | Requires Azure CORS configuration |
| **SpreadsheetRenderer** | `fetch(url).then(r => r.arrayBuffer())`      | Yes           | Requires Azure CORS configuration |
| **TextRenderer**  | `fetch(url).then(r => r.text())`             | Yes           | Requires Azure CORS configuration |
| **ImageRenderer** | `<img src={url}>`                            | No            | Native `<img>` tags bypass CORS   |

**Required Azure Blob Storage CORS rule:**

| Field             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Allowed origins   | `http://localhost:5173` (dev), `https://yourdomain.com` (prod) |
| Allowed methods   | `GET`, `HEAD`, `OPTIONS`                                       |
| Allowed headers   | `*`                                                            |
| Exposed headers   | `*`                                                            |
| Max age (seconds) | `3600`                                                         |

Configure via Azure Portal: Storage account > Settings > Resource sharing (CORS) > Blob service.

---

## Adding a New Renderer

To add support for a new file type:

### 1. Create a renderer component

Create a new file in `renderers/`, e.g., `VideoRenderer.tsx`:

```typescript
import type { RendererProps } from '../types';

export function VideoRenderer({ tab, isActive }: Readonly<RendererProps>) {
  if (!isActive) {
    return null;
  }

  return (
    <video
      src={tab.url}
      controls
      className="w-full h-full"
    />
  );
}
```

**Note:** Using `Readonly<RendererProps>` ensures props are marked as read-only for Sonar compliance.

### 2. Register in the renderer map

In `renderers/index.ts`, import the renderer and add entries to `RENDERER_MAP`:

```typescript
import { VideoRenderer } from './VideoRenderer';

const RENDERER_MAP: Record<string, React.ComponentType<any>> = {
  // ... existing entries
  'video/mp4': VideoRenderer,
  'video/webm': VideoRenderer,
};
```

### 3. Add extension-to-MIME mapping

If you want `isViewableFilename()` to detect the new type, add entries to `EXT_TO_MIME`:

```typescript
const EXT_TO_MIME: Record<string, string> = {
  // ... existing entries
  mp4: 'video/mp4',
  webm: 'video/webm',
};
```

### 4. Export (optional)

If the renderer needs to be used directly, add it to the exports in `renderers/index.ts`:

```typescript
export { VideoRenderer } from './VideoRenderer';
```

That's it! The `FileViewerContent` component automatically picks up new renderers via `getRenderer()`.
