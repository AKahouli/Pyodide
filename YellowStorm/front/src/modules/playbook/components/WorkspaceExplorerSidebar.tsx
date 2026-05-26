'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Search, PanelLeftClose, FolderOpen, FileText, ChevronRight, ChevronDown,
  Loader2, Upload, Plus, Trash2, RefreshCw, Clock, Check, AlertTriangle,
  FileX, Home, MoreHorizontal
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
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
import { Separator } from '@/components/ui/separator';
import { useWorkspaceExplorerOpen, usePlaybookStore } from '../store';
import * as workspaceApi from '@/modules/workspace/api';
import { validateFiles, ACCEPT_EXTENSIONS, SMALL_FILE_THRESHOLD } from '@/modules/workspace/utils';
import type { Workspace, WorkspaceDocument, IndexingStatus } from '@/modules/workspace/types';
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
    documentId?: string;
    filename?: string;
    filepath?: string;
    language?: string;
    mimeType?: string;
  };
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

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  // Document/folder state
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [allFolders, setAllFolders] = useState<WorkspaceDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
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

  // Sort documents: folders first, then alphabetical
  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return (a.originalName || a.filename).localeCompare(b.originalName || b.filename);
    });
  }, [documents]);

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
        const result = await workspaceApi.getWorkspaces({ limit: 100 });
        const workspacesList = result.workspaces;
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

  // Fetch documents and folders when workspace or folder changes
  const fetchDocuments = useCallback(async (workspaceId: string, folderId: string | null) => {
    setDocsLoading(true);
    try {
      const result = await workspaceApi.getHierarchicalDocuments(workspaceId, {
        limit: 100,
      });
      const visibleDocuments = result.documents.filter(
        (document) => (document.parentId ?? null) === folderId,
      );
      setDocuments(visibleDocuments);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to fetch documents', err);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const fetchAllFolders = useCallback(async (workspaceId: string) => {
    try {
      const folders = await workspaceApi.getAllFolders(workspaceId);
      setAllFolders(folders);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to fetch folders', err);
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchDocuments(activeWorkspaceId, currentFolderId);
    fetchAllFolders(activeWorkspaceId);
  }, [activeWorkspaceId, currentFolderId, fetchDocuments, fetchAllFolders]);

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const items: { id: string; name: string }[] = [];
    let currentId = currentFolderId;
    while (currentId) {
      const folder = allFolders.find((d) => d.id === currentId && d.isFolder);
      if (folder) {
        items.unshift({ id: folder.id, name: folder.folderName || folder.originalName });
        currentId = folder.parentId || null;
      } else break;
    }
    return items;
  }, [allFolders, currentFolderId]);

  // Filtered documents based on search
  const filteredDocuments = useMemo(() => {
    if (!search.trim()) return sortedDocuments;
    const lower = search.toLowerCase();
    return sortedDocuments.filter(
      (d) => (d.originalName || d.filename).toLowerCase().includes(lower),
    );
  }, [sortedDocuments, search]);

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
          fetchDocuments(activeWorkspaceId, currentFolderId);
          fetchAllFolders(activeWorkspaceId);
        })
        .catch((err) => {
          setUploadQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: 'failed' as const, error: err instanceof Error ? err.message : 'Upload failed' } : q,
            ),
          );
        });
    });
  }, [activeWorkspaceId, currentFolderId, fetchDocuments, fetchAllFolders]);

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
      fetchDocuments(activeWorkspaceId, currentFolderId);
      fetchAllFolders(activeWorkspaceId);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to create folder', err);
    }
  }, [activeWorkspaceId, currentFolderId, createFolderName, fetchDocuments, fetchAllFolders]);

  // Delete document
  const handleDeleteDocument = useCallback(async () => {
    if (!activeWorkspaceId || !isDeleteDialogOpen || isDeleteDialogOpen.type !== 'document') return;
    try {
      await workspaceApi.deleteDocument(activeWorkspaceId, isDeleteDialogOpen.id);
      setIsDeleteDialogOpen(null);
      fetchDocuments(activeWorkspaceId, currentFolderId);
      fetchAllFolders(activeWorkspaceId);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to delete document', err);
    }
  }, [activeWorkspaceId, isDeleteDialogOpen, currentFolderId, fetchDocuments, fetchAllFolders]);

  // Delete folder
  const handleDeleteFolder = useCallback(async () => {
    if (!activeWorkspaceId || !isDeleteDialogOpen || isDeleteDialogOpen.type !== 'folder') return;
    try {
      await workspaceApi.deleteFolder(activeWorkspaceId, isDeleteDialogOpen.id);
      setIsDeleteDialogOpen(null);
      if (currentFolderId === isDeleteDialogOpen.id) {
        setCurrentFolderId(null);
      }
      setCurrentFolderId(null);
      fetchAllFolders(activeWorkspaceId);
      fetchDocuments(activeWorkspaceId, null);
    } catch (err) {
      console.error('WorkspaceExplorer: failed to delete folder', err);
    }
  }, [activeWorkspaceId, isDeleteDialogOpen, currentFolderId, fetchAllFolders, fetchDocuments]);

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
      const artifactKind = !document.isFolder
        ? inferArtifactKind(document.filename, document.mimeType)
        : undefined;
      const kind: PlaybookResourceKind = document.isFolder ? 'folder' : 'document';
      const payload: DragPayload = {
        type: kind,
        kind,
        id: document.id,
        name: document.originalName || document.filename,
        workspaceId: activeWorkspaceId ?? undefined,
        artifactKind,
        metadata: document.isFolder
          ? { workspaceId: activeWorkspaceId ?? undefined }
          : {
              workspaceId: activeWorkspaceId ?? undefined,
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
    [activeWorkspaceId],
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
                {ws.name} ({ws.documentCount})
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
            accept={ACCEPT_EXTENSIONS}
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
                  disabled={isUploading}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('workspaceExplorer.upload')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('workspaceExplorer.uploadTooltip')}</TooltipContent>
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
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('workspaceExplorer.folder')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('workspaceExplorer.folderTooltip')}</TooltipContent>
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

      {/* Breadcrumb navigation */}
      {activeWorkspace && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b shrink-0 overflow-x-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs gap-0.5 shrink-0"
            onClick={() => setCurrentFolderId(null)}
          >
            <Home className="h-3 w-3" />
          </Button>
          {breadcrumbs.map((item) => (
            <div key={item.id} className="flex items-center gap-0.5 shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs truncate max-w-24"
                onClick={() => setCurrentFolderId(item.id)}
              >
                {item.name}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Document/folder list */}
      <ScrollArea className="flex-1">
        {!activeWorkspace ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {t('workspaceExplorer.selectWorkspace')}
          </div>
        ) : docsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {search ? t('workspaceExplorer.noResults') : t('workspaceExplorer.noDocuments')}
          </div>
        ) : (
          <div className="p-1">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className={cn(
                  'group flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors',
                  hoveredItemId === doc.id && 'bg-muted/50',
                  selectedItems.includes(doc.id) && 'bg-muted',
                )}
                onMouseEnter={() => setHoveredItemId(doc.id)}
                onMouseLeave={() => setHoveredItemId(null)}
              >
                <Checkbox
                  checked={selectedItems.includes(doc.id)}
                  onCheckedChange={() => toggleItem(doc.id)}
                  className="h-4 w-4 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
                {doc.isFolder ? (
                  <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                {doc.isFolder ? (
                  <button
                    className="flex-1 text-left text-xs truncate min-w-0 hover:underline cursor-pointer"
                    onClick={() => setCurrentFolderId(doc.id)}
                    title={doc.folderName || doc.originalName}
                  >
                    {doc.folderName || doc.originalName}
                  </button>
                ) : (
                  <span
                    className={cn(
                      'flex-1 text-xs truncate min-w-0',
                      'cursor-grab active:cursor-grabbing',
                    )}
                    draggable
                    onDragStart={(e) => handleDragStart(e, doc)}
                    title={doc.originalName || doc.filename}
                  >
                    <OverflowTooltip text={doc.originalName || doc.filename} />
                  </span>
                )}

                {/* Indexing status badge (documents only) */}
                {!doc.isFolder && (
                  <IndexingBadge status={doc.indexingStatus} error={doc.indexingError} />
                )}

                {/* Hover actions */}
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
                              onClick={() => handleReindex(doc.id)}
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
                            onClick={() =>
                              setIsDeleteDialogOpen({
                                type: doc.isFolder ? 'folder' : 'document',
                                id: doc.id,
                                name: doc.isFolder ? doc.folderName || doc.originalName : doc.originalName || doc.filename,
                              })
                            }
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
            ))}
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
