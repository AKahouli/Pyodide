import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, ChevronRight, Download, DownloadCloud, Eye, File as FileIcon, FileText, FilePieChart, FileX, Folder, FolderKanban, FolderPlus, Globe, HardDrive, Home, Image as ImageIcon, Link2, Loader2, Move, MoreVertical, Network, Pencil, Plus, RefreshCw, Search, Settings, Shield, Sparkles, Trash2, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { isViewableFile, openFileViewer } from '@/modules/file-viewer';

import { useWorkspaceStore, useCanWriteWorkspace } from '../store';
import * as pageApi from '../page-api';
import type { Workspace, WorkspaceArtifact, WorkspaceFile, WorkspaceFolder, WorkspaceRole } from '../types';
import { WorkspaceArtifactRow } from './WorkspaceArtifactRow';
import { IndexingStatusDot } from './IndexingStatusDot';
import { groupBySourceRoot } from '../lib/source-groups';
import { SourceGroupRow } from './SourceGroupRow';
import { useAutoIndexation } from '../hooks/useAutoIndexation';
import { useDeepSearchIndexation } from '../hooks/useDeepSearchIndexation';
import { formatFileSize } from '../utils';
import { WorkspacePicker } from './WorkspacePicker';
import { CreateFolderDialog } from './CreateFolderDialog';
import { EditFolderDialog } from './EditFolderDialog';
import { MoveFolderDialog } from './MoveFolderDialog';
import { MoveFileDialog } from './MoveFileDialog';
import { ClassifyDialog } from './ClassifyDialog';
import { RulesDialog } from './RulesDialog';
import { WorkspaceUploadDropZone } from './WorkspaceUploadDropZone';
import { CommunityGraphPanel } from '@/modules/playbook/components/CommunityGraphPanel';
import { useModuleTranslation } from '@/modules/localization';
import { dataRoomFeatures } from '@/config/dataRoomFeatures';

const ITEM_MIME = 'application/x-workspace-page-item';

type DragPayload = { kind: 'file'; id: string; name: string } | { kind: 'folder'; id: string; name: string };

function readItemPayload(dt: DataTransfer): DragPayload | null {
  try {
    const raw = dt.getData(ITEM_MIME);
    if (!raw) return null;
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function hasItemPayload(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(ITEM_MIME);
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('sheet') || mime.includes('csv')) return FilePieChart;
  return FileIcon;
}

function getItemIcon(file: WorkspaceFile) {
  if (file.type === 'url') return Globe;
  return getFileIcon(file.mimeType);
}

export function WorkspacePage() {
  const { t } = useModuleTranslation('workspace');
  const { id: routeWorkspaceId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const selectedWorkspace = useWorkspaceStore((s) => s.selectedWorkspace);
  const selectedWorkspaceRole = useWorkspaceStore((s) => s.selectedWorkspaceRole);
  const canWrite = useCanWriteWorkspace();
  const selectPageWorkspace = useWorkspaceStore((s) => s.selectPageWorkspace);
  const folders = useWorkspaceStore((s) => s.pageFolders);
  const files = useWorkspaceStore((s) => s.pageFiles);
  const storedArtifacts = useWorkspaceStore((s) => s.pageArtifacts);
  const artifacts =storedArtifacts ;
  const currentFolderId = useWorkspaceStore((s) => s.pageCurrentFolderId);
  const navigateToFolder = useWorkspaceStore((s) => s.navigateToPageFolder);
  const search = useWorkspaceStore((s) => s.pageSearch);
  const setSearch = useWorkspaceStore((s) => s.setPageSearch);
  const loadingPageFolders = useWorkspaceStore((s) => s.loadingPageFolders);
  const loadingPageFiles = useWorkspaceStore((s) => s.loadingPageFiles);
  const pageWorkspaceLoadedFor = useWorkspaceStore((s) => s.pageWorkspaceLoadedFor);
  const deletePageFolder = useWorkspaceStore((s) => s.deletePageFolder);
  const movePageFolder = useWorkspaceStore((s) => s.movePageFolder);
  const setFileFolderAssignment = useWorkspaceStore((s) => s.setFileFolderAssignment);
  const refreshPageData = useWorkspaceStore((s) => s.refreshPageData);
  const refreshWorkspaceArtifacts = useWorkspaceStore((s) => s.refreshWorkspaceArtifacts);
  const openAddLink = useWorkspaceStore((s) => s.openAddLink);

  useEffect(() => {
    if (routeWorkspaceId && routeWorkspaceId !== selectedWorkspaceId) {
      void selectPageWorkspace(routeWorkspaceId);
    } else if (!routeWorkspaceId && selectedWorkspaceId) {
      void selectPageWorkspace(null);
    }
  }, [routeWorkspaceId, selectedWorkspaceId, selectPageWorkspace]);

  // TEMP diagnostic: log the indexing statuses the workspace page receives.
  useEffect(() => {
    if (!files.length) return;
    const counts = files.reduce<Record<string, number>>((acc, f) => {
      const s = f.indexingStatus ?? 'undefined';
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    console.log('[indexing-status] received files', {
      total: files.length,
      counts,
      sample: files.slice(0, 5).map((f) => ({ name: f.name, indexingStatus: f.indexingStatus })),
    });
  }, [files]);

  // While any file is still indexing, poll so its status dot updates to
  // green/red on its own without a manual refresh. Stops once all settle.
  const hasIndexingInFlight = files.some(
    (f) =>
      f.indexingStatus === 'pending' ||
      f.indexingStatus === 'processing' ||
      (f.type === 'url' && f.status === 'processing'),
  );
  useEffect(() => {
    if (!hasIndexingInFlight) return;
    const interval = setInterval(() => {
      void refreshPageData();
    }, 5000);
    return () => clearInterval(interval);
  }, [hasIndexingInFlight, refreshPageData]);

  const hasArtifactGenerationInFlight = artifacts.some(
    (artifact) => artifact.status === 'queued' || artifact.status === 'generating',
  );
  useEffect(() => {
    if (!hasArtifactGenerationInFlight) return;
    const interval = setInterval(() => {
      void refreshWorkspaceArtifacts();
    }, 5000);
    return () => clearInterval(interval);
  }, [hasArtifactGenerationInFlight, refreshWorkspaceArtifacts]);

  const activeWorkspaceId = routeWorkspaceId ?? null;

  // True only during the FIRST fetch for this workspace (not during background
  // index-status polls), so the "empty" state never flashes before data loads.
  const isInitialLoading =
    !!activeWorkspaceId &&
    pageWorkspaceLoadedFor !== activeWorkspaceId &&
    (loadingPageFolders || loadingPageFiles);

  const [createOpen, setCreateOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<WorkspaceFolder | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<WorkspaceFolder | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ files: WorkspaceFile[]; title: string } | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{ files: WorkspaceFile[]; label: string } | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const deleteDocument = useWorkspaceStore((s) => s.deleteDocument);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { enabled: autoIndex, setEnabled: setAutoIndex } = useAutoIndexation();
  const { enabled: deepSearch, setEnabled: setDeepSearch } = useDeepSearchIndexation();

  const handleSync = useCallback(async () => {
    if (!activeWorkspaceId || isSyncing) return;
    setIsSyncing(true);
    const loadingToastId = toast.loading('Génération de l’archive ZIP…');
    try {
      const { blob, filename, fileCount, unclassifiedCount, failedCount } = await pageApi.syncWorkspace(activeWorkspaceId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.dismiss(loadingToastId);
      if (failedCount > 0) {
        toast.warning(`Archive prête (${fileCount} fichier(s))`, {
          description: `${failedCount} fichier(s) n’ont pas pu être inclus.`,
        });
      } else {
        toast.success(`Archive prête (${fileCount} fichier(s))`, {
          description: unclassifiedCount > 0 ? `${unclassifiedCount} fichier(s) à la racine.` : undefined,
        });
      }
    } catch (err) {
      toast.dismiss(loadingToastId);
      const message = err instanceof Error ? err.message : 'Échec de la génération du ZIP';
      toast.error('Sync impossible', { description: message });
    } finally {
      setIsSyncing(false);
    }
  }, [activeWorkspaceId, isSyncing]);

  const handleDeleteGroup = useCallback(async () => {
    if (!deleteGroupTarget) return;
    setIsDeletingGroup(true);
    try {
      // Delete every page in the group; cascade any linked artifacts.
      for (const file of deleteGroupTarget.files) {
        await deleteDocument(file.workspaceId, file.id, true);
      }
      toast.success(`Groupe « ${deleteGroupTarget.label} » supprimé`);
      setDeleteGroupTarget(null);
      await refreshPageData();
    } catch {
      // toast handled by the store
    } finally {
      setIsDeletingGroup(false);
    }
  }, [deleteGroupTarget, deleteDocument, refreshPageData]);

  const breadcrumbs = useMemo(() => {
    if (!currentFolderId) return [] as WorkspaceFolder[];
    const chain: WorkspaceFolder[] = [];
    let cursor: WorkspaceFolder | undefined = folders.find((f) => f.id === currentFolderId);
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? folders.find((f) => f.id === cursor!.parentId) : undefined;
    }
    return chain;
  }, [folders, currentFolderId]);

  const visibleFolders = useMemo(() => {
    if (!activeWorkspaceId) return [];
    const q = search.trim().toLowerCase();
    return folders
      .filter((f) => f.workspaceId === activeWorkspaceId && f.parentId === currentFolderId)
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, activeWorkspaceId, currentFolderId, search]);

  const visibleFiles = useMemo(() => {
    if (!activeWorkspaceId) return [];
    const q = search.trim().toLowerCase();
    return files
      .filter((f) => f.workspaceId === activeWorkspaceId)
      .filter((f) => (currentFolderId ? f.folderId === currentFolderId : f.folderId === null))
      .filter((f) => !q || f.name.toLowerCase().includes(q) || artifacts.some((artifact) => artifact.primarySource.documentId === f.id && artifact.name.toLowerCase().includes(q)));
  }, [files, artifacts, activeWorkspaceId, currentFolderId, search]);

  const renderFileRow = (file: WorkspaceFile) => {
    const query = search.trim().toLowerCase();
    const sourceMatches = file.name.toLowerCase().includes(query);
    const allLinkedArtifacts = artifacts.filter((artifact) => artifact.primarySource.documentId === file.id);
    const linkedArtifacts = allLinkedArtifacts.filter((artifact) => !query || sourceMatches || artifact.name.toLowerCase().includes(query));
    return (
      <FileRow
        key={file.id}
        file={file}
        artifacts={linkedArtifacts}
        totalArtifactCount={allLinkedArtifacts.length}
        forceExpanded={!!query && !sourceMatches && linkedArtifacts.length > 0}
        onMove={() => setMoveTarget({ files: [file], title: file.name })}
      />
    );
  };

  const handleDropOnFolder = useCallback(
    (targetFolder: WorkspaceFolder, payload: DragPayload) => {
      if (!canWrite) return;
      if (payload.kind === 'file') {
        void setFileFolderAssignment(payload.id, targetFolder.id);
        toast.success(`${payload.name} déplacé dans ${targetFolder.name}`);
      } else {
        if (payload.id === targetFolder.id) return;
        void movePageFolder(payload.id, targetFolder.id);
        toast.success(`${payload.name} déplacé dans ${targetFolder.name}`);
      }
    },
    [canWrite, movePageFolder, setFileFolderAssignment],
  );

  const handleDropOnBreadcrumb = useCallback(
    (targetParentId: string | null, payload: DragPayload) => {
      if (!canWrite) return;
      if (payload.kind === 'file') {
        void setFileFolderAssignment(payload.id, targetParentId);
        toast.success(targetParentId ? `${payload.name} déplacé` : `${payload.name} retiré du classement`);
      } else {
        void movePageFolder(payload.id, targetParentId);
        toast.success(`${payload.name} déplacé`);
      }
    },
    [canWrite, movePageFolder, setFileFolderAssignment],
  );

  if (!activeWorkspaceId) {
    return <EmptyWorkspaceState />;
  }

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      {/* Header */}
      <div className='border-b bg-background/80 backdrop-blur-xl'>
        <div className='mx-auto flex w-full max-w-7xl items-center gap-3 px-6 py-5'>
          <div className='flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15'>
            <FolderKanban className='h-5 w-5' />
          </div>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-1.5'>
              {selectedWorkspace ? <EditableWorkspaceName workspace={selectedWorkspace} canEdit={selectedWorkspaceRole === 'owner' && !selectedWorkspace.isPersonal} /> : <h1 className='text-xl font-semibold leading-tight tracking-tight'>Workspace</h1>}
              {selectedWorkspace && !canWrite && (
                <span className='inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
                  <Eye className='h-3 w-3' /> Lecture seule
                </span>
              )}
              {selectedWorkspace && <WorkspaceActionsMenu workspace={selectedWorkspace} role={selectedWorkspaceRole} onDeleted={() => navigate('/workspace')} />}
            </div>
            <p className='text-xs text-muted-foreground'>Organisez, classez et indexez vos documents au sein d'un workspace.</p>
          </div>
          {selectedWorkspace && <StorageIndicator workspace={selectedWorkspace} />}
          <WorkspacePicker />
        </div>
      </div>

      {/* Toolbar */}
      <div className='border-b bg-card/40'>
        <div className='mx-auto flex w-full max-w-7xl items-center gap-3 px-6 py-3'>
          <div className='relative w-64 shrink-0'>
            <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Rechercher dossier ou fichier…' className='pl-9 pr-9 h-9' />
            {search && (
              <button onClick={() => setSearch('')} className='absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted'>
                <X className='h-3.5 w-3.5' />
              </button>
            )}
          </div>

          <div className='flex items-center gap-2 overflow-x-auto'>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className='flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 h-9'>
                    <Label htmlFor='auto-indexation-toggle' className='cursor-pointer text-xs font-medium leading-none select-none'>
                      Auto-indexation
                    </Label>
                    <Switch id='auto-indexation-toggle' checked={autoIndex} onCheckedChange={setAutoIndex} aria-label="Activer l'indexation automatique des fichiers uploadés" />
                    <span className={cn('text-[10px] font-semibold uppercase tracking-wide tabular-nums', autoIndex ? 'text-primary' : 'text-muted-foreground')}>{autoIndex ? 'ON' : 'OFF'}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side='bottom' className='max-w-xs text-center'>
                  {autoIndex ? 'Les nouveaux fichiers uploadés sont envoyés au pipeline d’indexation automatiquement.' : 'Les fichiers sont uploadés sans indexation. Vous pouvez indexer manuellement plus tard.'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className='flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 h-9'>
                    <Label htmlFor='deep-search-toggle' className='cursor-pointer text-xs font-medium leading-none select-none'>
                      Recherche approfondie
                    </Label>
                    <Switch id='deep-search-toggle' checked={deepSearch} onCheckedChange={setDeepSearch} aria-label="Activer la recherche approfondie lors de l'indexation" />
                    <span className={cn('text-[10px] font-semibold uppercase tracking-wide tabular-nums', deepSearch ? 'text-primary' : 'text-muted-foreground')}>{deepSearch ? 'ON' : 'OFF'}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side='bottom' className='max-w-xs text-center'>
                  {deepSearch ? 'Indexation avec analyse approfondie : le document est envoyé au graphe de connaissances en plus de l\'indexation standard.' : 'Indexation standard uniquement. Activez pour enrichir le document avec une analyse approfondie.'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Separator orientation='vertical' className='h-6' />
            {canWrite && (
              <Button variant='outline' size='sm' onClick={() => setCreateOpen(true)} className='gap-1.5'>
                <FolderPlus className='h-4 w-4' />
                Nouveau dossier
              </Button>
            )}
            {canWrite && (
              <Button variant='outline' size='sm' onClick={() => setRulesOpen(true)} className='gap-1.5'>
                <Shield className='h-4 w-4' />
                Règles
              </Button>
            )}
            <Button variant='outline' size='sm' onClick={handleSync} disabled={isSyncing} className='gap-1.5'>
              {isSyncing ? <Loader2 className='h-4 w-4 animate-spin' /> : <DownloadCloud className='h-4 w-4' />}
              Sync
            </Button>
            <Button variant='outline' size='sm' onClick={() => setGraphOpen(true)} className='gap-1.5'>
              <Network className='h-4 w-4' />
              Graphe
            </Button>
            {canWrite && (
              <>
                <Separator orientation='vertical' className='h-6' />
                <Button size='sm' className='gap-1.5' onClick={() => setClassifyOpen(true)}>
                  <Sparkles className='h-4 w-4' />
                  Classifier
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Breadcrumb */}
        <div className='mx-auto flex w-full max-w-7xl items-center gap-1 px-6 pb-3 text-sm'>
          <BreadcrumbItem isActive={!currentFolderId} onClick={() => navigateToFolder(null)} onDropItem={(payload) => handleDropOnBreadcrumb(null, payload)}>
            <Home className='h-3.5 w-3.5' />
            Accueil
          </BreadcrumbItem>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={crumb.id} className='flex items-center gap-1'>
                <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                <BreadcrumbItem isActive={isLast} onClick={() => navigateToFolder(crumb.id)} onDropItem={(payload) => handleDropOnBreadcrumb(crumb.id, payload)}>
                  {crumb.name}
                </BreadcrumbItem>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className='flex-1'>
        <div className='mx-auto w-full max-w-7xl px-6 py-6 space-y-6'>
          <WorkspaceUploadDropZone />
          {isInitialLoading ? (
            <WorkspaceContentLoading />
          ) : visibleFolders.length === 0 && visibleFiles.length === 0 ? (
            <EmptyFolderState hasSearch={!!search} canCreate={canWrite} onCreateFolder={() => setCreateOpen(true)} />
          ) : (
            <div className='space-y-8'>
              {visibleFolders.length > 0 && (
                <section>
                  <SectionHeader title='Dossiers' count={visibleFolders.length} icon={<Folder className='h-3.5 w-3.5' />} />
                  <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'>
                    {visibleFolders.map((folder) => {
                      const childCount = folders.filter((f) => f.parentId === folder.id).length;
                      const fileCount = files.filter((f) => f.workspaceId === activeWorkspaceId && f.folderId === folder.id).length;
                      return <FolderCard key={folder.id} folder={folder} childCount={childCount} fileCount={fileCount} onOpen={() => navigateToFolder(folder.id)} onEdit={() => setEditFolder(folder)} onMove={() => setMoveFolderTarget(folder)} onDelete={() => deletePageFolder(folder.id)} onDropItem={(payload) => handleDropOnFolder(folder, payload)} />;
                    })}
                  </div>
                </section>
              )}

              {visibleFiles.length > 0 && (
                <section>
                  <SectionHeader title='Fichiers' count={visibleFiles.length} icon={<FileIcon className='h-3.5 w-3.5' />} />
                  {/* Group only at the workspace root with no active search. While a
                      search is active, render flat so matching pages surface directly
                      instead of being hidden inside a collapsed start-URL group. */}
                  {search.trim() ? (
                    <div className='space-y-1'>{visibleFiles.map(renderFileRow)}</div>
                  ) : (() => {
                    const { groups, loose } = groupBySourceRoot(visibleFiles);
                    return (
                      <div className='space-y-1'>
                        {groups.map((group) => (
                          <SourceGroupRow key={group.key} label={group.label} rootUrl={group.rootUrl} count={group.files.length} status={group.status} onOpenInNavigator={(url) => openAddLink({ url, autoStart: true, sourceGroupId: group.key, seed: group.files.filter((f) => f.sourceUrl).map((f) => ({ url: f.sourceUrl as string, name: f.name, indexingStatus: f.indexingStatus })) })} onMove={() => setMoveTarget({ files: group.files, title: group.label })} onDelete={canWrite ? () => setDeleteGroupTarget({ files: group.files, label: group.label }) : undefined}>
                            {group.files.map(renderFileRow)}
                          </SourceGroupRow>
                        ))}
                        {loose.map(renderFileRow)}
                      </div>
                    );
                  })()}
                </section>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateFolderDialog open={createOpen} onOpenChange={setCreateOpen} parentId={currentFolderId} />
      <EditFolderDialog open={!!editFolder} onOpenChange={(o) => !o && setEditFolder(null)} folder={editFolder} />
      <MoveFolderDialog open={!!moveFolderTarget} onOpenChange={(o) => !o && setMoveFolderTarget(null)} folder={moveFolderTarget} />
      <MoveFileDialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)} files={moveTarget?.files ?? []} title={moveTarget?.title ?? ''} />
      <Dialog open={!!deleteGroupTarget} onOpenChange={(o) => !isDeletingGroup && !o && setDeleteGroupTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer le groupe</DialogTitle>
            <DialogDescription>
              Voulez-vous vraiment supprimer le groupe <span className='font-medium text-foreground'>{deleteGroupTarget?.label}</span> et ses {deleteGroupTarget?.files.length ?? 0} lien(s) indexé(s) ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteGroupTarget(null)} disabled={isDeletingGroup}>
              Annuler
            </Button>
            <Button variant='destructive' onClick={handleDeleteGroup} disabled={isDeletingGroup} className='gap-1.5'>
              {isDeletingGroup ? <Loader2 className='h-4 w-4 animate-spin' /> : <Trash2 className='h-4 w-4' />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ClassifyDialog open={classifyOpen} onOpenChange={setClassifyOpen} />
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
      <CommunityGraphPanel open={graphOpen} onOpenChange={setGraphOpen} workspaceId={selectedWorkspaceId} />
    </div>
  );
}

function WorkspaceActionsMenu({ workspace, role, onDeleted }: { workspace: Workspace; role: WorkspaceRole; onDeleted: () => void }) {
  const openSettingsModal = useWorkspaceStore((s) => s.openSettingsModal);
  const openShareModal = useWorkspaceStore((s) => s.openShareModal);
  const deleteAllDocuments = useWorkspaceStore((s) => s.deleteAllDocuments);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [confirmDeleteDocs, setConfirmDeleteDocs] = useState(false);
  const [confirmDeleteWs, setConfirmDeleteWs] = useState(false);
  const [isDeletingDocs, setIsDeletingDocs] = useState(false);
  const [isDeletingWs, setIsDeletingWs] = useState(false);

  const canShare = role === 'owner' && !workspace.isPersonal;
  const canDeleteDocs = role !== 'read' && workspace.documentCount > 0;
  const canDeleteWorkspace = role === 'owner' && !workspace.isPersonal;

  const handleDeleteDocs = useCallback(async () => {
    setIsDeletingDocs(true);
    try {
      await deleteAllDocuments(workspace.id);
      setConfirmDeleteDocs(false);
    } catch {
      // toast handled by store
    } finally {
      setIsDeletingDocs(false);
    }
  }, [deleteAllDocuments, workspace.id]);

  const handleDeleteWorkspace = useCallback(async () => {
    setIsDeletingWs(true);
    try {
      await deleteWorkspace(workspace.id);
      setConfirmDeleteWs(false);
      onDeleted();
    } catch {
      // toast handled by store
    } finally {
      setIsDeletingWs(false);
    }
  }, [deleteWorkspace, onDeleted, workspace.id]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type='button' className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground' aria-label='Actions du workspace'>
            <MoreVertical className='h-4 w-4' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='w-auto'>
          <DropdownMenuItem onClick={() => openSettingsModal(workspace)}>
            <Settings className='mr-2 h-4 w-4' />
            Paramètres
          </DropdownMenuItem>
          {canShare && (
            <DropdownMenuItem onClick={() => openShareModal(workspace)}>
              <Users className='mr-2 h-4 w-4' />
              Partager
            </DropdownMenuItem>
          )}
          {(canDeleteDocs || canDeleteWorkspace) && <DropdownMenuSeparator />}
          {canDeleteDocs && (
            <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteDocs(true)}>
              <FileX className='mr-2 h-4 w-4' />
              Supprimer tous les documents
            </DropdownMenuItem>
          )}
          {canDeleteWorkspace && (
            <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteWs(true)}>
              <Trash2 className='mr-2 h-4 w-4' />
              Supprimer le workspace
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDeleteDocs} onOpenChange={(o) => !isDeletingDocs && setConfirmDeleteDocs(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer tous les documents</DialogTitle>
            <DialogDescription>
              Voulez-vous vraiment supprimer les {workspace.documentCount} document(s) de <span className='font-medium text-foreground'>{workspace.name}</span> ? Les dossiers et règles seront conservés. Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirmDeleteDocs(false)} disabled={isDeletingDocs}>
              Annuler
            </Button>
            <Button variant='destructive' onClick={handleDeleteDocs} disabled={isDeletingDocs} className='gap-1.5'>
              {isDeletingDocs ? <Loader2 className='h-4 w-4 animate-spin' /> : <FileX className='h-4 w-4' />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteWs} onOpenChange={(o) => !isDeletingWs && setConfirmDeleteWs(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer le workspace</DialogTitle>
            <DialogDescription>
              Voulez-vous vraiment supprimer définitivement <span className='font-medium text-foreground'>{workspace.name}</span> ainsi que ses {workspace.documentCount} document(s) ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirmDeleteWs(false)} disabled={isDeletingWs}>
              Annuler
            </Button>
            <Button variant='destructive' onClick={handleDeleteWorkspace} disabled={isDeletingWs} className='gap-1.5'>
              {isDeletingWs ? <Loader2 className='h-4 w-4 animate-spin' /> : <Trash2 className='h-4 w-4' />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditableWorkspaceName({ workspace, canEdit }: { workspace: Workspace; canEdit: boolean }) {
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setDraft(workspace.name);
  }, [workspace.name, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commit = useCallback(async () => {
    if (isSaving) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === workspace.name) {
      setIsEditing(false);
      setDraft(workspace.name);
      return;
    }
    setIsSaving(true);
    try {
      await renameWorkspace(workspace.id, trimmed);
      setIsEditing(false);
    } catch {
      setDraft(workspace.name);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, renameWorkspace, workspace.id, workspace.name]);

  if (!canEdit) {
    return (
      <h1 className='text-xl font-semibold leading-tight tracking-tight truncate' title={workspace.name}>
        {workspace.name}
      </h1>
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(workspace.name);
            setIsEditing(false);
          }
        }}
        disabled={isSaving}
        maxLength={100}
        aria-label='Renommer le workspace'
        className='w-full bg-transparent text-xl font-semibold leading-tight tracking-tight outline-none border-b border-primary/40 focus:border-primary disabled:opacity-60'
      />
    );
  }

  return (
    <button type='button' onClick={() => setIsEditing(true)} title='Cliquez pour renommer' className='group inline-flex max-w-full items-center gap-1.5 rounded-sm text-left'>
      <span className='truncate text-xl font-semibold leading-tight tracking-tight group-hover:text-primary transition-colors'>{workspace.name}</span>
      <Pencil className='h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100' />
    </button>
  );
}

function StorageIndicator({ workspace }: { workspace: Workspace }) {
  const used = Math.max(0, workspace.usedStorage ?? 0);
  const allocated = Math.max(0, workspace.allocatedStorage ?? 0);
  const rawPercent = allocated > 0 ? Math.min(100, (used / allocated) * 100) : 0;

  const formatPercent = (p: number): string => {
    if (used > 0 && p < 0.1) return '<0.1%';
    if (p < 1) return `${p.toFixed(2)}%`;
    if (p < 10) return `${p.toFixed(1)}%`;
    return `${Math.round(p)}%`;
  };
  const percentLabel = formatPercent(rawPercent);
  // Ensure the bar shows a visible sliver as soon as there's any usage
  const barValue = used > 0 ? Math.max(1.5, rawPercent) : 0;

  const isWarning = rawPercent >= 80 && rawPercent < 95;
  const isCritical = rawPercent >= 95;
  const tone = isCritical ? 'text-destructive' : isWarning ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground';
  const barTone = isCritical ? 'bg-destructive' : isWarning ? 'bg-amber-500' : 'bg-primary';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='hidden md:flex h-9 min-w-[180px] max-w-[240px] items-center gap-2 rounded-md border bg-card/60 px-3' role='group' aria-label='Stockage du workspace'>
            <HardDrive className={cn('h-3.5 w-3.5 shrink-0', tone)} />
            <div className='flex-1 min-w-0 space-y-1'>
              <div className='flex items-baseline justify-between gap-2 text-[11px] tabular-nums leading-none'>
                <span className={cn('font-medium', tone)}>{formatFileSize(used)}</span>
                <span className='text-muted-foreground'>{formatFileSize(allocated)}</span>
              </div>
              <Progress value={barValue} className='h-1.5' indicatorClassName={barTone} />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='text-center'>
          {allocated > 0 ? `${percentLabel} utilisé · ${formatFileSize(Math.max(0, allocated - used))} restant` : 'Stockage illimité'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BreadcrumbItem({ children, isActive, onClick, onDropItem }: { children: React.ReactNode; isActive: boolean; onClick: () => void; onDropItem: (payload: DragPayload) => void }) {
  const [isOver, setIsOver] = useState(false);

  return (
    <button
      onClick={onClick}
      onDragOver={(e) => {
        if (!hasItemPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        setIsOver(false);
        const payload = readItemPayload(e.dataTransfer);
        if (!payload) return;
        e.preventDefault();
        onDropItem(payload);
      }}
      className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors', isActive ? 'bg-secondary text-secondary-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground', isOver && 'bg-primary/10 text-primary ring-1 ring-primary/40')}>
      {children}
    </button>
  );
}

function SectionHeader({ title, count, icon }: { title: string; count: number; icon: React.ReactNode }) {
  return (
    <div className='mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
      <span className='flex h-5 w-5 items-center justify-center rounded bg-secondary text-secondary-foreground'>{icon}</span>
      {title}
      <span className='rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground'>{count}</span>
    </div>
  );
}

function FolderCard({ folder, childCount, fileCount, onOpen, onEdit, onMove, onDelete, onDropItem }: { folder: WorkspaceFolder; childCount: number; fileCount: number; onOpen: () => void; onEdit: () => void; onMove: () => void; onDelete: () => void; onDropItem: (payload: DragPayload) => void }) {
  const canWrite = useCanWriteWorkspace();
  const [isOver, setIsOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    if (!canWrite) return;
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ kind: 'folder', id: folder.id, name: folder.name }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!canWrite || !hasItemPayload(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!canWrite) return;
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
    const payload = readItemPayload(e.dataTransfer);
    if (!payload) return;
    if (payload.kind === 'folder' && payload.id === folder.id) return;
    onDropItem(payload);
  };

  const borderClass = isOver ? 'border-primary' : 'border-border group-hover:border-primary/50';

  return (
    <div className={cn('group relative pt-2 transition-transform duration-200', 'hover:-translate-y-0.5', isDragging && 'opacity-50')}>
      <div className={cn('absolute left-4 top-0 h-2.5 w-20 rounded-t-md bg-card border border-b-0 transition-colors', borderClass)} />
      <div draggable={canWrite} onDragStart={handleDragStart} onDragEnd={() => setIsDragging(false)} onDragOver={handleDragOver} onDragLeave={() => setIsOver(false)} onDrop={handleDrop} className={cn('relative overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm transition-colors', canWrite && 'cursor-grab active:cursor-grabbing', borderClass, isOver && 'ring-2 ring-primary/30')}>
        <button onClick={onOpen} className='w-full text-left p-4 pb-3'>
          <div className='flex items-start gap-3'>
            <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Folder className='h-6 w-6' />
            </div>
            <div className='min-w-0 flex-1'>
              <div className='font-semibold leading-tight truncate'>{folder.name}</div>
              <div className='mt-1 text-xs text-muted-foreground line-clamp-2 min-h-8'>{folder.description || 'Sans description'}</div>
            </div>
          </div>
        </button>

        <div className='flex items-center justify-between border-t border-border/60 bg-muted/40 px-4 py-2 text-xs text-muted-foreground'>
          <div className='flex items-center gap-3'>
            <span className='inline-flex items-center gap-1'>
              <Folder className='h-3 w-3' /> {childCount}
            </span>
            <span className='inline-flex items-center gap-1'>
              <FileIcon className='h-3 w-3' /> {fileCount}
            </span>
          </div>

          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className='rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background'>
                  <MoreVertical className='h-4 w-4' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className='mr-2 h-4 w-4' /> Renommer / éditer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMove}>
                  <Move className='mr-2 h-4 w-4' /> Déplacer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={onDelete}>
                  <Trash2 className='mr-2 h-4 w-4' /> Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}

function FileRow({ file, artifacts, totalArtifactCount, forceExpanded, onMove }: { file: WorkspaceFile; artifacts: WorkspaceArtifact[]; totalArtifactCount: number; forceExpanded: boolean; onMove: () => void }) {
  const { t } = useModuleTranslation('workspace');
  const Icon = getItemIcon(file);
  const isConverting = file.type === 'url' && file.status === 'processing';
  const canWrite = useCanWriteWorkspace();
  const [isDragging, setIsDragging] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [expanded, setExpanded] = useState(forceExpanded);

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  useEffect(() => {
    if (artifacts.some((artifact) => artifact.status === 'queued' || artifact.status === 'generating')) setExpanded(true);
  }, [artifacts]);

  const deleteDocument = useWorkspaceStore((s) => s.deleteDocument);
  const getDownloadUrl = useWorkspaceStore((s) => s.getDownloadUrl);
  const reindexDocument = useWorkspaceStore((s) => s.reindexDocument);
  const renameDocument = useWorkspaceStore((s) => s.renameDocument);
  const refreshPageData = useWorkspaceStore((s) => s.refreshPageData);
  const { enabled: deepSearch } = useDeepSearchIndexation();

  // A link only has a real, openable blob once conversion completes. Until then
  // its `path` is an internal `link-pending:` placeholder, so view/download must
  // be suppressed (otherwise the viewer signs the placeholder and errors).
  const isStored = file.type !== 'url' || file.status === 'completed';
  const viewable = isViewableFile(file.mimeType) && !!file.path && !isConverting && isStored;

  const handleDragStart = (e: React.DragEvent) => {
    if (!canWrite) return;
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ kind: 'file', id: file.id, name: file.name }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleView = useCallback(() => {
    if (!viewable) return;
    // `file.path` is the Ceph object key persisted on the WorkspaceDocument.
    // openFileViewer signs it directly via the path-signer endpoint.
    openFileViewer(file.workspaceId, file.id, file.path ?? '', file.name, file.mimeType, { canWriteWorkspace: canWrite });
  }, [canWrite, file.id, file.mimeType, file.name, file.path, file.workspaceId, viewable]);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      const url = await getDownloadUrl(file.workspaceId, file.id);
      window.open(url, '_blank');
    } catch {
      // toast handled by the store
    } finally {
      setIsDownloading(false);
    }
  }, [file.id, file.workspaceId, getDownloadUrl]);

  const handleReindex = useCallback(async () => {
    setIsReindexing(true);
    try {
      await reindexDocument(file.workspaceId, file.id, deepSearch);
      toast.success(`${file.name} envoyé à l'indexation`);
      // Refresh so the status dot reflects the new "pending/processing" state.
      await refreshPageData();
    } catch {
      // toast handled by the store
    } finally {
      setIsReindexing(false);
    }
  }, [file.id, file.name, file.workspaceId, reindexDocument, refreshPageData, deepSearch]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteDocument(file.workspaceId, file.id, totalArtifactCount > 0);
      setConfirmDeleteOpen(false);
      toast.success(`${file.name} supprimé`);
      await refreshPageData();
    } catch {
      // toast handled by the store
    } finally {
      setIsDeleting(false);
    }
  }, [deleteDocument, file.id, file.name, file.workspaceId, refreshPageData, totalArtifactCount]);

  const primaryContent = <>
    <Icon className='h-5 w-5 shrink-0 text-muted-foreground' />
    <div className='min-w-0 flex-1 flex items-center gap-2'>
      {isConverting ? (
        <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
        </span>
      ) : (
        <IndexingStatusDot status={file.indexingStatus} error={file.indexingError} />
      )}
      <span className='truncate text-sm'>{file.name}</span>
      {totalArtifactCount > 0 && <span className='text-xs text-muted-foreground'>{t('artifacts.count', { count: totalArtifactCount })}</span>}
    </div>
    <span className='hidden md:inline text-xs text-muted-foreground tabular-nums whitespace-nowrap'>{formatBytes(file.size)}</span>
  </>;

  return (
    <>
      <div
        draggable={canWrite}
        onDragStart={handleDragStart}
        onDragEnd={() => setIsDragging(false)}
        className={cn('group flex items-center gap-4 rounded-md py-2 pl-2 pr-1 transition-colors', 'hover:bg-accent/50', canWrite && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-50')}
      >
        {artifacts.length > 0 ? <button type='button' onClick={() => setExpanded((value) => !value)} aria-label={expanded ? t('artifacts.collapse') : t('artifacts.expand')}><ChevronRight className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')} /></button> : <span className='w-4' />}
        {viewable
          ? <button type='button' className='flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left' onClick={handleView}>{primaryContent}</button>
          : <div className='flex min-w-0 flex-1 items-center gap-4'>{primaryContent}</div>}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className='rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100'>
              <MoreVertical className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {viewable && (
              <DropdownMenuItem onClick={handleView}>
                <Eye className='mr-2 h-4 w-4' /> Voir
              </DropdownMenuItem>
            )}
            {isStored && (
              <DropdownMenuItem onClick={handleDownload} disabled={isDownloading}>
                {isDownloading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Download className='mr-2 h-4 w-4' />}
                Télécharger
              </DropdownMenuItem>
            )}
            {canWrite && (
              <>
                <DropdownMenuItem onClick={handleReindex} disabled={isReindexing}>
                  {isReindexing ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <RefreshCw className='mr-2 h-4 w-4' />}
                  Indexer / Réindexer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil className='mr-2 h-4 w-4' /> Renommer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMove}>
                  <ArrowRight className='mr-2 h-4 w-4' /> Déplacer dans…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteOpen(true)}>
                  <Trash2 className='mr-2 h-4 w-4' /> Supprimer
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && artifacts.map((artifact) => <WorkspaceArtifactRow key={artifact.id} artifact={artifact} canWrite={canWrite} onChanged={refreshPageData} />)}

      <ConfirmDeleteFileDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen} fileName={file.name} linkedArtifactCount={totalArtifactCount} isDeleting={isDeleting} onConfirm={handleDelete} />

      <RenameFileDialog open={renameOpen} onOpenChange={setRenameOpen} currentName={file.name} onRename={(name) => renameDocument(file.workspaceId, file.id, name)} />
    </>
  );
}

function RenameFileDialog({ open, onOpenChange, currentName, onRename }: { open: boolean; onOpenChange: (open: boolean) => void; currentName: string; onRename: (name: string) => Promise<void> }) {
  const [name, setName] = useState(currentName);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { if (open) setName(currentName); }, [open, currentName]);

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName || isSaving) return;
    setIsSaving(true);
    try {
      await onRename(trimmed);
      toast.success('Fichier renommé');
      onOpenChange(false);
    } catch {
      toast.error('Le renommage a échoué.');
    } finally {
      setIsSaving(false);
    }
  }, [name, currentName, isSaving, onRename, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(o) => !isSaving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renommer le fichier</DialogTitle>
          <DialogDescription>Modifiez le nom d'affichage de ce fichier. L'extension est conservée.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
          aria-label='Nouveau nom du fichier'
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isSaving}>Annuler</Button>
          <Button onClick={save} disabled={isSaving || !name.trim() || name.trim() === currentName} className='gap-1.5'>
            {isSaving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Pencil className='h-4 w-4' />}
            Renommer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDeleteFileDialog({ open, onOpenChange, fileName, linkedArtifactCount, isDeleting, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; fileName: string; linkedArtifactCount: number; isDeleting: boolean; onConfirm: () => void | Promise<void> }) {
  const { t } = useModuleTranslation('workspace');
  return (
    <Dialog open={open} onOpenChange={(o) => !isDeleting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('artifacts.sourceDeleteTitle')}</DialogTitle>
          <DialogDescription>
            {linkedArtifactCount > 0 && <span className='mb-2 block font-medium text-destructive'>{t('artifacts.sourceDeleteWarning', { count: linkedArtifactCount })}</span>}
            {t('artifacts.sourceDeleteDescription', { name: fileName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isDeleting}>
            {t('artifacts.cancel')}
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isDeleting} className='gap-1.5'>
            {isDeleting ? <Loader2 className='h-4 w-4 animate-spin' /> : <Trash2 className='h-4 w-4' />}
            {linkedArtifactCount > 0 ? t('artifacts.deleteSourceAndFlows') : t('artifacts.deleteSource')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Skeleton shown during the first load of a workspace so the empty state never
 * flashes before folders/files arrive. */
function WorkspaceContentLoading() {
  return (
    <div className='space-y-8' aria-busy='true' aria-live='polite'>
      <section>
        <div className='mb-3 h-4 w-24 rounded bg-muted animate-pulse' />
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className='rounded-md border bg-card p-4'>
              <div className='flex items-start gap-3'>
                <div className='h-12 w-12 shrink-0 rounded-lg bg-muted animate-pulse' />
                <div className='flex-1 space-y-2 pt-1'>
                  <div className='h-3.5 w-2/3 rounded bg-muted animate-pulse' />
                  <div className='h-3 w-full rounded bg-muted animate-pulse' />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className='mb-3 h-4 w-20 rounded bg-muted animate-pulse' />
        <div className='space-y-1'>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className='flex items-center gap-4 rounded-md py-2 pl-2 pr-1'>
              <div className='h-5 w-5 shrink-0 rounded bg-muted animate-pulse' />
              <div className={cn('h-3.5 rounded bg-muted animate-pulse', i % 2 === 0 ? 'w-1/2' : 'w-1/3')} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EmptyFolderState({ hasSearch, canCreate, onCreateFolder }: { hasSearch: boolean; canCreate: boolean; onCreateFolder: () => void }) {
  if (hasSearch) {
    return (
      <div className='flex flex-col items-center justify-center py-24 text-center'>
        <div className='mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted'>
          <Search className='h-6 w-6 text-muted-foreground' />
        </div>
        <h3 className='text-sm font-semibold'>Aucun résultat</h3>
        <p className='mt-1 text-xs text-muted-foreground'>Essayez avec d'autres mots-clés.</p>
      </div>
    );
  }

  return (
    <div className='flex flex-col items-center justify-center py-20 text-center'>
      <div className='mb-5 flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15'>
        <Folder className='h-7 w-7' />
      </div>
      <h3 className='text-base font-semibold'>Cet emplacement est vide</h3>
      <p className='mt-1 max-w-sm text-sm text-muted-foreground'>
        {canCreate
          ? "Créez un dossier pour structurer votre classification ou utilisez la zone d'upload ci-dessus pour ajouter des fichiers."
          : 'Ce workspace partagé est en lecture seule.'}
      </p>
      {canCreate && (
        <div className='mt-5 flex items-center gap-2'>
          <Button variant='outline' onClick={onCreateFolder} className='gap-1.5'>
            <FolderPlus className='h-4 w-4' />
            Nouveau dossier
          </Button>
        </div>
      )}
    </div>
  );
}

function EmptyWorkspaceState() {
  const [rulesOpen, setRulesOpen] = useState(false);
  const openCreateModal = useWorkspaceStore((s) => s.openCreateModal);

  return (
    <div className='relative flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-background p-6'>
      <div
        className='pointer-events-none absolute inset-0 -z-10 opacity-60'
        style={{
          background: 'radial-gradient(600px circle at 50% 35%, hsl(var(--primary) / 0.07), transparent 60%)',
        }}
      />

      <div className='w-full max-w-md space-y-7 text-center'>
        <div className='relative mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20'>
          <FolderKanban className='h-8 w-8' />
          <span className='absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background'>
            <Sparkles className='h-3.5 w-3.5' />
          </span>
        </div>

        <div className='space-y-2'>
          <h1 className='text-2xl font-semibold tracking-tight'>Bienvenue dans Workspace</h1>
          <p className='text-sm text-muted-foreground'>Organisez vos documents en dossiers décrits, uploadez en drag & drop, puis laissez un playbook IA classifier chaque fichier automatiquement.</p>
        </div>

        <div className='space-y-2'>
          <WorkspacePicker variant='hero' />
          <p className='text-xs text-muted-foreground'>Sélectionnez un workspace ou créez-en un nouveau.</p>
        </div>

        <div className='flex flex-wrap items-center justify-center gap-2'>
          <Button size='sm' onClick={() => openCreateModal()} className='gap-1.5'>
            <Plus className='h-4 w-4' />
            Nouveau workspace
          </Button>
          <Button variant='outline' size='sm' onClick={() => setRulesOpen(true)} className='gap-1.5'>
            <Shield className='h-4 w-4' />
            Règles globales
          </Button>
        </div>

        <div className='flex items-center justify-center gap-x-5 gap-y-2 flex-wrap pt-2 text-xs text-muted-foreground'>
          <InfoItem icon={<FolderPlus className='h-3.5 w-3.5' />} label='Hiérarchie décrite' />
          <InfoItem icon={<Link2 className='h-3.5 w-3.5' />} label='Drag & drop' />
          <InfoItem icon={<Sparkles className='h-3.5 w-3.5' />} label='Playbook IA' />
        </div>
      </div>

      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} globalOnly />
    </div>
  );
}

function InfoItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      {icon}
      {label}
    </span>
  );
}
