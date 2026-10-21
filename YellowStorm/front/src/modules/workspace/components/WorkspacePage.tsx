import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from '@/lib/notifications';
import { ArrowRight, ChevronRight, Download, DownloadCloud, Eye, File as FileIcon, FileText, FilePieChart, FileX, Folder, FolderKanban, FolderPlus, Globe, HardDrive, Home, Image as ImageIcon, Link2, Loader2, Move, MoreVertical, Network, Pencil, Plus, RefreshCw, Search, Settings, Shield, Sparkles, Trash2, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isViewableFile, openFileViewer } from '@/modules/file-viewer';

import { useWorkspaceStore, useCanWriteWorkspace } from '../store';
import * as pageApi from '../page-api';
import type { Workspace, WorkspaceArtifact, WorkspaceFile, WorkspaceFolder, WorkspaceRole } from '../types';
import { WorkspaceArtifactRow } from './WorkspaceArtifactRow';
import { WorkspaceIndexingStatus } from './WorkspaceIndexingStatus';
import { WorkspaceFileBrowser, type FileRowSelection } from './WorkspaceFileBrowser';
import { WorkspaceUploadActivity } from './WorkspaceUploadActivity';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { useAutoIndexation, readAutoIndexationValue } from '../hooks/useAutoIndexation';
import { useDeepSearchIndexation, readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';
import { useIndexingNotifications } from '../hooks/useIndexingNotifications';
import { formatFileSize } from '../utils';
import { WorkspacePicker } from './WorkspacePicker';
import { CreateFolderDialog } from './CreateFolderDialog';
import { EditFolderDialog } from './EditFolderDialog';
import { ClassifyDialog } from './ClassifyDialog';
import { RulesDialog } from './RulesDialog';
import { WorkspaceUploadDropZone } from './WorkspaceUploadDropZone';
import { CommunityGraphPanel } from '@/modules/playbook/components/CommunityGraphPanel';
import { useModuleTranslation } from '@/modules/localization';

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
  const refreshPageData = useWorkspaceStore((s) => s.refreshPageData);
  const refreshWorkspaceArtifacts = useWorkspaceStore((s) => s.refreshWorkspaceArtifacts);

  useEffect(() => {
    if (routeWorkspaceId && routeWorkspaceId !== selectedWorkspaceId) {
      void selectPageWorkspace(routeWorkspaceId);
    } else if (!routeWorkspaceId && selectedWorkspaceId) {
      void selectPageWorkspace(null);
    }
  }, [routeWorkspaceId, selectedWorkspaceId, selectPageWorkspace]);

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
  const [externalDrag, setExternalDrag] = useState(false);
  const externalDragDepth = useRef(0);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { enabled: autoIndex, setEnabled: setAutoIndex } = useAutoIndexation();
  const { enabled: deepSearch, setEnabled: setDeepSearch } = useDeepSearchIndexation();
  useIndexingNotifications();

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

  const renderFileRow = (file: WorkspaceFile, selection: FileRowSelection) => {
    const query = search.trim().toLowerCase();
    const sourceMatches = file.name.toLowerCase().includes(query);
    const allLinkedArtifacts = artifacts.filter((artifact) => artifact.primarySource.documentId === file.id);
    const linkedArtifacts = allLinkedArtifacts.filter((artifact) => !query || sourceMatches || artifact.name.toLowerCase().includes(query));
    return (
      <FileRow
        key={file.id}
        selection={selection}
        file={file}
        artifacts={linkedArtifacts}
        totalArtifactCount={allLinkedArtifacts.length}
        forceExpanded={!!query && !sourceMatches && linkedArtifacts.length > 0}
        onMove={() => selection.onMove?.()}
      />
    );
  };

  if (!activeWorkspaceId) {
    return <EmptyWorkspaceState />;
  }

  return (
    <div className='relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground'
      onDragEnterCapture={event => { if (canWrite && event.dataTransfer.types.includes('Files')) { event.preventDefault(); externalDragDepth.current++; setExternalDrag(true); } }}
      onDragOverCapture={event => { if (canWrite && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDragLeaveCapture={event => { if (event.dataTransfer.types.includes('Files')) { externalDragDepth.current = Math.max(0, externalDragDepth.current - 1); if (!externalDragDepth.current) setExternalDrag(false); } }}
      onDropCapture={event => { if (!canWrite || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); event.stopPropagation(); externalDragDepth.current = 0; setExternalDrag(false); if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { toast.warning(t('explorer.useFolderPicker')); return; } void useWorkspaceStore.getState().uploadPageFiles(Array.from(event.dataTransfer.files), { autoIndex: readAutoIndexationValue(), deepSearch: readDeepSearchIndexationValue() }); }}>
      <header className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-6'>
        <div className='flex min-w-0 items-center gap-3'>
          <FolderKanban className='hidden h-6 w-6 shrink-0 text-primary sm:block' />
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-1'>
              {selectedWorkspace ? <EditableWorkspaceName workspace={selectedWorkspace} canEdit={selectedWorkspaceRole === 'owner' && !selectedWorkspace.isPersonal} /> : <h1 className='text-xl font-semibold'>{t('explorer.workspace')}</h1>}
              {selectedWorkspace && <WorkspaceActionsMenu workspace={selectedWorkspace} role={selectedWorkspaceRole} onDeleted={() => navigate('/workspace')} />}
              {!canWrite && <span className='shrink-0 rounded bg-muted px-2 py-1 text-xs text-muted-foreground'>{t('explorer.readOnly')}</span>}
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>{t('explorer.description')}</p>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {selectedWorkspace && <StorageIndicator workspace={selectedWorkspace} />}
          <WorkspacePicker />
          {canWrite && <Button variant='outline' size='sm' className='gap-2' onClick={() => setCreateOpen(true)}><FolderPlus className='h-4 w-4' />{t('explorer.newFolder')}</Button>}
          <WorkspaceUploadDropZone />
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant='ghost' size='icon' aria-label={t('explorer.moreOptions')}><MoreVertical className='h-4 w-4' /></Button></DropdownMenuTrigger><DropdownMenuContent align='end' className='w-72'>
            {canWrite && <><div className='flex items-center justify-between gap-4 px-2 py-3'><Label htmlFor='auto-indexation-toggle' className='text-sm'>{t('explorer.autoIndex')}</Label><Switch id='auto-indexation-toggle' checked={autoIndex} onCheckedChange={setAutoIndex} aria-label={t('explorer.autoIndex')} /></div><div className='flex items-center justify-between gap-4 px-2 py-3'><Label htmlFor='deep-search-toggle' className='text-sm'>{t('explorer.deepSearch')}</Label><Switch id='deep-search-toggle' checked={deepSearch} onCheckedChange={setDeepSearch} aria-label={t('explorer.deepSearch')} /></div><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setRulesOpen(true)}><Shield className='me-2 h-4 w-4' />{t('explorer.rules')}</DropdownMenuItem><DropdownMenuItem onClick={() => setClassifyOpen(true)}><Sparkles className='me-2 h-4 w-4' />{t('explorer.classify')}</DropdownMenuItem></>}
            <DropdownMenuItem onClick={handleSync} disabled={isSyncing}><DownloadCloud className='me-2 h-4 w-4' />{t('explorer.downloadWorkspace')}</DropdownMenuItem><DropdownMenuItem onClick={() => setGraphOpen(true)}><Network className='me-2 h-4 w-4' />{t('explorer.graph')}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div>
      </header>
      {isInitialLoading ? <div className='flex-1 overflow-y-auto p-6'><WorkspaceContentLoading /></div> : <WorkspaceFileBrowser key={activeWorkspaceId} workspaceId={activeWorkspaceId} folders={folders} files={files} artifacts={artifacts} currentFolderId={currentFolderId} search={search} onSearch={setSearch} onNavigate={navigateToFolder} onEditFolder={setEditFolder} renderFile={renderFileRow} />}
      <WorkspaceUploadActivity />

      <CreateFolderDialog open={createOpen} onOpenChange={setCreateOpen} parentId={currentFolderId} />
      <EditFolderDialog open={!!editFolder} onOpenChange={(o) => !o && setEditFolder(null)} folder={editFolder} />
      <ClassifyDialog open={classifyOpen} onOpenChange={setClassifyOpen} />
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
      <CommunityGraphPanel open={graphOpen} onOpenChange={setGraphOpen} workspaceId={selectedWorkspaceId} />
      {externalDrag && <div className='pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/95 p-6 text-center'><p className='text-lg font-medium'>{t('uploadActivity.dropHere')}</p></div>}
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
            <Settings className='me-2 h-4 w-4' />
            Paramètres
          </DropdownMenuItem>
          {canShare && (
            <DropdownMenuItem onClick={() => openShareModal(workspace)}>
              <Users className='me-2 h-4 w-4' />
              Partager
            </DropdownMenuItem>
          )}
          {(canDeleteDocs || canDeleteWorkspace) && <DropdownMenuSeparator />}
          {canDeleteDocs && (
            <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteDocs(true)}>
              <FileX className='me-2 h-4 w-4' />
              Supprimer tous les documents
            </DropdownMenuItem>
          )}
          {canDeleteWorkspace && (
            <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteWs(true)}>
              <Trash2 className='me-2 h-4 w-4' />
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
    <button type='button' onClick={() => setIsEditing(true)} title='Cliquez pour renommer' className='group inline-flex max-w-full items-center gap-1.5 rounded-sm text-start'>
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

function FileRow({ file, artifacts, totalArtifactCount, forceExpanded, onMove, selection }: { file: WorkspaceFile; artifacts: WorkspaceArtifact[]; totalArtifactCount: number; forceExpanded: boolean; onMove: () => void; selection: FileRowSelection }) {
  const { t } = useModuleTranslation('workspace');
  const Icon = getItemIcon(file);
  const isConverting = file.type === 'url' && file.status === 'processing';
  const canWrite = useCanWriteWorkspace();
  const openAddLink = useWorkspaceStore(s => s.openAddLink);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [expanded, setExpanded] = useState(forceExpanded);
  const shiftSelection = useRef(false);

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
    <Icon className='h-4 w-4 shrink-0 text-muted-foreground' />
    <span className='min-w-0 flex-1'>
      <span className='block truncate text-sm' title={file.name}>{file.name}</span>
      <span className='block sm:hidden'><WorkspaceIndexingStatus file={file} /></span>
    </span>
    {totalArtifactCount > 0 && <span className='shrink-0 text-xs text-muted-foreground'>{t('artifacts.count', { count: totalArtifactCount })}</span>}
  </>;

  return (
    <>
      <TableRow data-state={selection.selected ? 'selected' : undefined}>
        {canWrite && <TableCell className='w-10'><Checkbox aria-label={t('explorer.selectItem', { name: file.name })} checked={selection.selected} disabled={selection.disabled} onClick={e => { shiftSelection.current = e.shiftKey; }} onCheckedChange={() => { selection.onToggle(shiftSelection.current); shiftSelection.current = false; }} /></TableCell>}
        <TableCell className='min-w-0'>
          <div className='flex min-w-0 items-center gap-1'>
            {artifacts.length > 0 && <button type='button' className='shrink-0 rounded p-1 hover:bg-accent' onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={expanded ? t('artifacts.collapse') : t('artifacts.expand')}><ChevronRight className={cn('h-4 w-4', expanded && 'rotate-90')} /></button>}
            {viewable ? <button type='button' className='flex min-w-0 flex-1 items-center gap-2 py-1 text-start hover:underline' onClick={handleView}>{primaryContent}</button> : <div className='flex min-w-0 flex-1 items-center gap-2 py-1'>{primaryContent}</div>}
          </div>
        </TableCell>
        <TableCell className='hidden sm:table-cell'><WorkspaceIndexingStatus file={file} /></TableCell>
        <TableCell className='hidden text-end text-xs text-muted-foreground lg:table-cell'>{formatBytes(file.size)}</TableCell>
        <TableCell className='hidden text-end text-xs text-muted-foreground xl:table-cell'>{file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : '—'}</TableCell>
        <TableCell className='w-10'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type='button' disabled={selection.batchMode || selection.disabled} aria-label={t('explorer.itemActions', { name: file.name })} className='rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40'>
              <MoreVertical className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {viewable && (
              <DropdownMenuItem onClick={handleView}>
                <Eye className='me-2 h-4 w-4' /> {t('explorer.view')}
              </DropdownMenuItem>
            )}
            {isStored && (
              <DropdownMenuItem onClick={handleDownload} disabled={isDownloading}>
                {isDownloading ? <Loader2 className='me-2 h-4 w-4 animate-spin' /> : <Download className='me-2 h-4 w-4' />}
                {t('explorer.download')}
              </DropdownMenuItem>
            )}
            {file.sourceRootUrl && <DropdownMenuItem onClick={() => openAddLink({ url: file.sourceRootUrl!, autoStart: true, sourceGroupId: file.sourceGroupId, seed: useWorkspaceStore.getState().pageFiles.filter(f => file.sourceGroupId ? f.sourceGroupId === file.sourceGroupId : f.sourceRootUrl === file.sourceRootUrl).filter(f => !!f.sourceUrl).map(f => ({ url: f.sourceUrl!, name: f.name, indexingStatus: f.indexingStatus })) })}><Globe className='me-2 h-4 w-4' />{t('explorer.openSource')}</DropdownMenuItem>}
            {canWrite && (
              <>
                <DropdownMenuItem onClick={handleReindex} disabled={isReindexing}>
                  {isReindexing ? <Loader2 className='me-2 h-4 w-4 animate-spin' /> : <RefreshCw className='me-2 h-4 w-4' />}
                  {t('explorer.index')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil className='me-2 h-4 w-4' /> {t('explorer.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMove}>
                  <ArrowRight className='me-2 h-4 w-4' /> {t('explorer.move')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteOpen(true)}>
                  <Trash2 className='me-2 h-4 w-4' /> {t('explorer.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </TableCell>
      </TableRow>

      {expanded && artifacts.length > 0 && <TableRow><TableCell colSpan={canWrite ? 6 : 5} className='bg-muted/20 ps-8'>{artifacts.map(artifact => <WorkspaceArtifactRow key={artifact.id} artifact={artifact} canWrite={canWrite} onChanged={refreshPageData} />)}</TableCell></TableRow>}

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
            <div key={i} className='flex items-center gap-4 rounded-md py-2 ps-2 pe-1'>
              <div className='h-5 w-5 shrink-0 rounded bg-muted animate-pulse' />
              <div className={cn('h-3.5 rounded bg-muted animate-pulse', i % 2 === 0 ? 'w-1/2' : 'w-1/3')} />
            </div>
          ))}
        </div>
      </section>
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
