'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Search, PanelLeftClose, FolderOpen, FileText, ChevronRight, ChevronDown,
  Loader2, Upload, Plus, Trash2, RefreshCw, Clock, Check, AlertTriangle,
  FileX, Network,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ResizablePanel, OverflowTooltip } from '@/components/ui/resizable-panel';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspaceExplorerOpen, usePlaybookStore } from '../store';
import * as workspaceApi from '@/modules/workspace/api';
import { validateFiles, SMALL_FILE_THRESHOLD } from '@/modules/workspace/utils';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
import { isSharedWorkspace, type SharedWorkspaceResponse, type Workspace, type WorkspaceDocument, type IndexingStatus } from '@/modules/workspace/types';
import type { InputFile, PlaybookResourceKind } from '../types';
import type { ArtifactKind } from '../types';
import { cn } from '@/lib/utils';
import { inferArtifactKind } from '../utils/infer-artifact-kind';
import { useModuleTranslation } from '@/modules/localization';
import { Progress } from '@/components/ui/progress';

const EXPLORER_STORAGE_KEY = 'ys_workspace_explorer_state';

interface ExplorerState {
  activeWorkspaceId: string | null;
}

function loadExplorerState(): ExplorerState {
  try {
    const stored = localStorage.getItem(EXPLORER_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* noop */ }
  return { activeWorkspaceId: null };
}

function saveExplorerState(state: ExplorerState) {
  try { localStorage.setItem(EXPLORER_STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

interface DragPayload {
  type: 'workspace' | 'document' | 'folder';
  kind: PlaybookResourceKind;
  id: string;
  name: string;
  workspaceId?: string;
  artifactKind?: ArtifactKind;
  metadata?: {
    workspaceId?: string;
    workspaceName?: string;
    documentId?: string;
    filename?: string;
    filepath?: string;
    folderpath?: string;
    language?: string;
    mimeType?: string;
  };
}

interface DocumentTreeNode {
  document: WorkspaceDocument;
  children: DocumentTreeNode[];
}

function getDocumentDisplayName(document: WorkspaceDocument): string {
  return document.isFolder
    ? document.folderName || document.originalName || document.filename
    : document.originalName || document.filename;
}

function buildDocumentTree(documents: WorkspaceDocument[]): DocumentTreeNode[] {
  const nodesById = new Map<string, DocumentTreeNode>();
  const roots: DocumentTreeNode[] = [];

  for (const document of documents) {
    nodesById.set(document.id, { document, children: [] });
  }

  for (const node of nodesById.values()) {
    const parentId = node.document.parentId ?? null;
    const parent = parentId ? nodesById.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: DocumentTreeNode[]) => {
    items.sort((a, b) => {
      if (a.document.isFolder && !b.document.isFolder) return -1;
      if (!a.document.isFolder && b.document.isFolder) return 1;
      return getDocumentDisplayName(a.document).localeCompare(getDocumentDisplayName(b.document));
    });
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);

  return roots;
}

function IndexingBadge({ status, error }: { status: IndexingStatus; error?: string }) {
  const config: Record<IndexingStatus, { icon: React.ReactNode; label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    none: { icon: <FileX className='h-3 w-3' />, label: 'Not Indexed', variant: 'outline' },
    pending: { icon: <Clock className='h-3 w-3' />, label: 'Pending', variant: 'secondary' },
    processing: { icon: <Loader2 className='h-3 w-3 animate-spin' />, label: 'Indexing', variant: 'secondary' },
    ready: { icon: <Check className='h-3 w-3' />, label: 'Indexed', variant: 'default' },
    failed: { icon: <AlertTriangle className='h-3 w-3' />, label: 'Failed', variant: 'destructive' },
  };

  const { icon, label, variant } = config[status] || config.pending;

  const badge = (
    <Badge variant={variant} className='text-[10px] h-5 px-1.5 gap-1 shrink-0'>
      {icon}{label}
    </Badge>
  );

  if (status === 'failed' && error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent><p className='max-w-xs text-sm'>{error}</p></TooltipContent>
      </Tooltip>
    );
  }
  return badge;
}

interface UploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

export function WorkspaceExplorerSidebar() {
  const isOpen = useWorkspaceExplorerOpen();
  const setOpen = usePlaybookStore((s) => s.setWorkspaceExplorerOpen);
  const { t } = useModuleTranslation('playbook');
  const { accept } = useAllowedUploadExtensions();

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Array<Workspace | SharedWorkspaceResponse>>([]);
  const [loading, setLoading] = useState(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  // Document/folder state
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set(['root']));
  const [search, setSearch] = useState('');

  // Selection
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  // Upload
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderUploadRef = useRef<HTMLInputElement>(null);

  // Dialogs
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<{ type: 'document' | 'folder'; id: string; name: string } | null>(null);

  // Hover for inline actions
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  // Load persisted state
  useEffect(() => {
    const state = loadExplorerState();
    if (state.activeWorkspaceId) setActiveWorkspaceId(state.activeWorkspaceId);
  }, []);

  useEffect(() => {
    saveExplorerState({ activeWorkspaceId });
  }, [activeWorkspaceId]);

  // Fetch workspaces
  useEffect(() => {
    if (!isOpen) return;
    async function fetch() {
      setLoading(true);
      try {
        const [ownedResult, sharedResult] = await Promise.allSettled([
          workspaceApi.getWorkspaces({ limit: 100 }),
          workspaceApi.getSharedWorkspaces({ limit: 100 }),
        ]);
        const workspacesList = [
          ...(ownedResult.status === 'fulfilled' ? ownedResult.value.workspaces : []),
          ...(sharedResult.status === 'fulfilled' ? sharedResult.value.workspaces : []),
        ];
        setWorkspaces(workspacesList);
        // Auto-select first workspace if none selected or saved selection no longer valid
        setActiveWorkspaceId((prev) => {
          if (prev && workspacesList.some((w) => w.id === prev)) return prev;
          return workspacesList[0]?.id ?? null;
        });
        setLoading(false);
      } catch (err) {
        console.error('WorkspaceExplorer: failed to fetch workspaces', err);
        setLoading(false);
      }
    }
    fetch();
  }, [isOpen]);

  // Fetch documents and folders when workspace changes
  const fetchDocuments = useCallback(async (workspaceId: string) => {
    setDocsLoading(true);
    try {
      const result = await workspaceApi.getHierarchicalDocuments(workspaceId, {
        limit: 100,
      });
      setDocuments(result.documents);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to fetch documents', err);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchDocuments(activeWorkspaceId);
  }, [activeWorkspaceId, fetchDocuments]);

  const documentTree = useMemo(() => buildDocumentTree(documents), [documents]);

  // Filtered documents based on search. Searching flattens matches so hidden nested results stay visible.
  const filteredDocuments = useMemo(() => {
    if (!search.trim()) return null;
    const lower = search.toLowerCase();
    return documents.filter(
      (d) => getDocumentDisplayName(d).toLowerCase().includes(lower),
    );
  }, [documents, search]);

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  // Upload handlers
  const handleUploadFiles = useCallback((files: File[]) => {
    if (!activeWorkspaceId) return;
    const { validFiles } = validateFiles(files);
    if (validFiles.length === 0) return;

    const newItems: UploadItem[] = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      file,
      status: 'pending' as const,
      progress: 0,
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);

    // Start upload
    setIsUploading(true);
    newItems.forEach((item) => {
      setUploadQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading' as const } : q)),
      );
      workspaceApi
        .uploadSmallFile(
          activeWorkspaceId,
          item.file,
          (progress) => {
            setUploadQueue((prev) =>
              prev.map((q) => (q.id === item.id ? { ...q, progress } : q)),
            );
          },
          currentFolderId ?? undefined,
        )
        .then(() => {
          setUploadQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: 'completed' as const, progress: 100 } : q)),
          );
          fetchDocuments(activeWorkspaceId);
        })
        .catch((err) => {
          setUploadQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: 'failed' as const, error: err instanceof Error ? err.message : 'Upload failed' } : q,
            ),
          );
        });
    });
  }, [activeWorkspaceId, currentFolderId, fetchDocuments]);

  // Clear completed/failed uploads after a delay
  useEffect(() => {
    const hasActive = uploadQueue.some((u) => u.status === 'pending' || u.status === 'uploading');
    if (!hasActive && uploadQueue.length > 0) {
      const timer = setTimeout(() => {
        setUploadQueue([]);
        setIsUploading(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [uploadQueue]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) handleUploadFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [handleUploadFiles],
  );

  // Create folder
  const handleCreateFolder = useCallback(async () => {
    if (!activeWorkspaceId || !createFolderName.trim()) return;
    try {
      await workspaceApi.createFolder(activeWorkspaceId, {
        name: createFolderName.trim(),
        parentId: currentFolderId ?? undefined,
      });
      setCreateFolderName('');
      setIsCreateFolderOpen(false);
      fetchDocuments(activeWorkspaceId);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to create folder', err);
    }
  }, [activeWorkspaceId, currentFolderId, createFolderName, fetchDocuments]);

  // Delete document
  const handleDeleteDocument = useCallback(async () => {
    if (!activeWorkspaceId || !isDeleteDialogOpen || isDeleteDialogOpen.type !== 'document') return;
    try {
      await workspaceApi.deleteDocument(activeWorkspaceId, isDeleteDialogOpen.id);
      setIsDeleteDialogOpen(null);
      fetchDocuments(activeWorkspaceId);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to delete document', err);
    }
  }, [activeWorkspaceId, isDeleteDialogOpen, fetchDocuments]);

  // Delete folder
  const handleDeleteFolder = useCallback(async () => {
    if (!activeWorkspaceId || !isDeleteDialogOpen || isDeleteDialogOpen.type !== 'folder') return;
    try {
      await workspaceApi.deleteFolder(activeWorkspaceId, isDeleteDialogOpen.id);
      setIsDeleteDialogOpen(null);
      setCurrentFolderId(null);
      fetchDocuments(activeWorkspaceId);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to delete folder', err);
    }
  }, [activeWorkspaceId, isDeleteDialogOpen, fetchDocuments]);

  // Reindex document
  const handleReindex = useCallback(async (docId: string) => {
    if (!activeWorkspaceId) return;
    try {
      await workspaceApi.reindexDocument(activeWorkspaceId, docId);
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, indexingStatus: 'pending' as IndexingStatus } : d)),
      );
    } catch (err) {
      console.error('WorkspaceExplorer: failed to reindex document', err);
    }
  }, [activeWorkspaceId]);

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, document: WorkspaceDocument) => {
      const workspaceName = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name;
      const artifactKind = !document.isFolder
        ? inferArtifactKind(document.filename, document.mimeType)
        : undefined;
      const kind: PlaybookResourceKind = document.isFolder ? 'folder' : 'document';
      const payload: DragPayload = {
        type: kind,
        kind,
        id: document.id,
        name: document.isFolder
          ? document.folderName || document.originalName || document.filename
          : document.originalName || document.filename,
        workspaceId: activeWorkspaceId ?? undefined,
        artifactKind,
        metadata: document.isFolder
          ? {
              workspaceId: activeWorkspaceId ?? undefined,
              workspaceName,
              folderpath: document.path,
            }
          : {
              workspaceId: activeWorkspaceId ?? undefined,
              workspaceName,
              documentId: document.id,
              filename: document.filename,
              filepath: document.path,
              language: document.metadata?.language,
              mimeType: document.mimeType,
            },
      };
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    },
    [activeWorkspaceId, workspaces],
  );

  const handleWorkspaceDragStart = useCallback(
    (e: React.DragEvent, workspace: Pick<Workspace, 'id' | 'name'>) => {
      const payload: DragPayload = {
        type: 'workspace',
        kind: 'workspace',
        id: workspace.id,
        name: workspace.name,
        workspaceId: workspace.id,
        metadata: {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        },
      };
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    },
    [],
  );

  // Toggle selection
  const toggleItem = useCallback((id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  }, []);

  // Upload progress
  const uploadProgress = uploadQueue.length > 0
    ? Math.round(uploadQueue.reduce((s, i) => s + i.progress, 0) / uploadQueue.length)
    : 0;
  const hasActiveUploads = uploadQueue.some((u) => u.status === 'pending' || u.status === 'uploading');

  if (!isOpen) return null;

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const isReadOnlySharedWorkspace = activeWorkspace
    ? isSharedWorkspace(activeWorkspace) && activeWorkspace.permission === 'read'
    : false;
  const isRootExpanded = expandedFolderIds.has('root');
  const visibleDocumentCount = filteredDocuments?.length ?? documents.length;

  const renderDocumentRow = (node: DocumentTreeNode, depth: number): ReactNode => {
    const doc = node.document;
    const displayName = getDocumentDisplayName(doc);
    const isFolderExpanded = expandedFolderIds.has(doc.id);
    const hasChildren = node.children.length > 0;

    return (
      <div key={doc.id}>
        <div
          className={cn(
            'group flex items-center gap-1 py-1.5 pr-2 rounded-md transition-colors cursor-grab',
            hoveredItemId === doc.id && 'bg-muted/50',
            selectedItems.includes(doc.id) && 'bg-muted',
            currentFolderId === doc.id && 'bg-muted/50',
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          draggable
          onDragStart={(e) => handleDragStart(e, doc)}
          onMouseEnter={() => setHoveredItemId(doc.id)}
          onMouseLeave={() => setHoveredItemId(null)}
          onClick={() => {
            if (doc.isFolder) setCurrentFolderId(doc.id);
          }}
        >
          <Checkbox
            checked={selectedItems.includes(doc.id)}
            onCheckedChange={() => toggleItem(doc.id)}
            className="h-4 w-4 shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
          {doc.isFolder ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 p-0"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolderExpanded(doc.id);
              }}
              aria-label={isFolderExpanded ? 'Collapse folder' : 'Expand folder'}
            >
              {hasChildren && isFolderExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : (
            <div className="h-5 w-5 shrink-0" />
          )}
          {doc.isFolder ? (
            <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <OverflowTooltip text={displayName} className="flex-1 min-w-0 text-xs" />

          {!doc.isFolder && <IndexingBadge status={doc.indexingStatus} error={doc.indexingError} />}

          {hoveredItemId === doc.id && (
            <div className="flex items-center gap-0.5 shrink-0">
              {!doc.isFolder && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReindex(doc.id);
                        }}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {doc.indexingStatus === 'none' ? t('workspaceExplorer.indexTooltip') : t('workspaceExplorer.reindexTooltip')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDeleteDialogOpen({
                          type: doc.isFolder ? 'folder' : 'document',
                          id: doc.id,
                          name: displayName,
                        });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">{t('workspaceExplorer.deleteTooltip')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
        {doc.isFolder && isFolderExpanded && node.children.map((child) => renderDocumentRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <ResizablePanel
      storageKey="ys_workspace_explorer_width"
      defaultWidth={320}
      minWidth={240}
      maxWidthRatio={0.4}
      handlePosition="right"
      className="border-l bg-background"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-sm font-semibold">{t('header.workspaceExplorer')}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Workspace selector */}
      <div className="px-3 py-2 border-b shrink-0">
        <select
          id="playbook-workspace-explorer-select"
          name="workspaceExplorerWorkspace"
          className="w-full h-8 text-sm rounded-md border border-input bg-background px-2"
          value={activeWorkspaceId ?? ''}
          onChange={(e) => {
            setActiveWorkspaceId(e.target.value || null);
            setCurrentFolderId(null);
            setSearch('');
            setSelectedItems([]);
          }}
        >
          {loading ? (
            <option value="">Loading...</option>
          ) : workspaces.length === 0 ? (
            <option value="">No workspaces</option>
          ) : (
            workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}{isSharedWorkspace(ws) ? ` (${t('workspace.sharedBadge')})` : ''} ({ws.documentCount})
              </option>
            ))
          )}
        </select>
      </div>

      {/* Action bar */}
      {activeWorkspace && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={handleUploadClick}
                  disabled={isUploading || isReadOnlySharedWorkspace}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('workspaceExplorer.upload')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isReadOnlySharedWorkspace ? t('workspaceExplorer.readOnlySharedWorkspace') : t('workspaceExplorer.uploadTooltip')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => {
                    setCreateFolderName('');
                    setIsCreateFolderOpen(true);
                  }}
                  disabled={isReadOnlySharedWorkspace}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('workspaceExplorer.folder')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isReadOnlySharedWorkspace ? t('workspaceExplorer.readOnlySharedWorkspace') : t('workspaceExplorer.folderTooltip')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => usePlaybookStore.getState().setGraphPanelOpen(true)}
                >
                  <Network className="h-3.5 w-3.5" />
                  {t('workspaceExplorer.graph')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('workspaceExplorer.graphTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Upload progress */}
      {uploadQueue.length > 0 && (
        <div className="px-3 py-1.5 border-b shrink-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              {t('workspaceExplorer.uploadProgress', { done: uploadQueue.filter((u) => u.status === 'completed').length, total: uploadQueue.length })}
            </span>
            {uploadQueue.some((u) => u.status === 'failed') && (
              <span className="text-destructive">
                {t('workspaceExplorer.uploadFailed', { count: uploadQueue.filter((u) => u.status === 'failed').length })}
              </span>
            )}
          </div>
          {hasActiveUploads && <Progress value={uploadProgress} className="h-1" />}
        </div>
      )}

      {/* Search bar */}
      <div className="px-3 py-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('workspaceExplorer.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Document/folder list */}
      <ScrollArea className="flex-1">
        {!activeWorkspace ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {t('workspaceExplorer.selectWorkspace')}
          </div>
        ) : (
          <div className="p-1">
            <div
              className={cn(
                'group flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors cursor-grab',
                currentFolderId === null && 'bg-muted/50',
              )}
              draggable
              onDragStart={(e) => handleWorkspaceDragStart(e, activeWorkspace)}
              onClick={() => setCurrentFolderId(null)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setCurrentFolderId(null);
              }}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolderExpanded('root');
                }}
                aria-label={isRootExpanded ? 'Collapse workspace' : 'Expand workspace'}
              >
                {isRootExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </Button>
              <FolderOpen className="h-4 w-4 shrink-0 text-sky-600" />
              <OverflowTooltip text={activeWorkspace.name} className="flex-1 min-w-0 text-xs font-medium" />
              <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
                {visibleDocumentCount}
              </Badge>
            </div>

            {isRootExpanded && docsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : isRootExpanded && filteredDocuments && filteredDocuments.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t('workspaceExplorer.noResults')}
              </div>
            ) : isRootExpanded && !filteredDocuments && documentTree.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t('workspaceExplorer.noDocuments')}
              </div>
            ) : isRootExpanded && filteredDocuments ? (
              filteredDocuments.map((doc) => renderDocumentRow({ document: doc, children: [] }, 1))
            ) : isRootExpanded ? (
              documentTree.map((node) => renderDocumentRow(node, 1))
            ) : null}
          </div>
        )}
      </ScrollArea>

      {/* Create Folder Dialog */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-500" />
              {t('workspaceExplorer.newFolderTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium mb-2">{t('workspaceExplorer.folderNameLabel')}</label>
              <Input
                value={createFolderName}
                onChange={(e) => setCreateFolderName(e.target.value)}
                placeholder={t('workspaceExplorer.folderNamePlaceholder')}
                maxLength={50}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateFolderOpen(false)}>
                {t('workspaceExplorer.cancel')}
              </Button>
              <Button onClick={handleCreateFolder} disabled={!createFolderName.trim()}>
                {t('workspaceExplorer.create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!isDeleteDialogOpen}
        onOpenChange={(open) => { if (!open) setIsDeleteDialogOpen(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isDeleteDialogOpen?.type === 'folder' ? t('workspaceExplorer.deleteFolderTitle') : t('workspaceExplorer.deleteDocumentTitle')}
            </DialogTitle>
            <DialogDescription>
              {isDeleteDialogOpen?.type === 'folder'
                ? t('workspaceExplorer.deleteFolderConfirm', { name: isDeleteDialogOpen?.name ?? '' })
                : t('workspaceExplorer.deleteDocumentConfirm', { name: isDeleteDialogOpen?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(null)}>
              {t('workspaceExplorer.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={isDeleteDialogOpen?.type === 'folder' ? handleDeleteFolder : handleDeleteDocument}
            >
              {t('workspaceExplorer.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ResizablePanel>
  );
}
