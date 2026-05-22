import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, ChevronRight, Download, Eye, File as FileIcon, FileText, FilePieChart, Folder, FolderKanban, FolderPlus, Home, Image as ImageIcon, Link2, Loader2, Move, MoreVertical, Pencil, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { isViewableFile, openFileViewer } from '@/modules/file-viewer';

import { useWorkspaceStore } from '../store';
import type { WorkspaceFile, WorkspaceFolder } from '../types';
import { WorkspacePicker } from './WorkspacePicker';
import { CreateFolderDialog } from './CreateFolderDialog';
import { EditFolderDialog } from './EditFolderDialog';
import { MoveFolderDialog } from './MoveFolderDialog';
import { MoveFileDialog } from './MoveFileDialog';
import { ClassifyDialog } from './ClassifyDialog';
import { WorkspaceUploadDropZone } from './WorkspaceUploadDropZone';

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

export function WorkspacePage() {
  const { id: routeWorkspaceId } = useParams<{ id?: string }>();
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const selectPageWorkspace = useWorkspaceStore((s) => s.selectPageWorkspace);
  const folders = useWorkspaceStore((s) => s.pageFolders);
  const files = useWorkspaceStore((s) => s.pageFiles);
  const currentFolderId = useWorkspaceStore((s) => s.pageCurrentFolderId);
  const navigateToFolder = useWorkspaceStore((s) => s.navigateToPageFolder);
  const search = useWorkspaceStore((s) => s.pageSearch);
  const setSearch = useWorkspaceStore((s) => s.setPageSearch);
  const deletePageFolder = useWorkspaceStore((s) => s.deletePageFolder);
  const movePageFolder = useWorkspaceStore((s) => s.movePageFolder);
  const setFileFolderAssignment = useWorkspaceStore((s) => s.setFileFolderAssignment);

  useEffect(() => {
    if (routeWorkspaceId && routeWorkspaceId !== selectedWorkspaceId) {
      void selectPageWorkspace(routeWorkspaceId);
    } else if (!routeWorkspaceId && selectedWorkspaceId) {
      void selectPageWorkspace(null);
    }
  }, [routeWorkspaceId, selectedWorkspaceId, selectPageWorkspace]);

  const activeWorkspaceId = routeWorkspaceId ?? null;

  const [createOpen, setCreateOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<WorkspaceFolder | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<WorkspaceFolder | null>(null);
  const [mapFile, setMapFile] = useState<WorkspaceFile | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);

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
      .filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [files, activeWorkspaceId, currentFolderId, search]);

  const handleDropOnFolder = useCallback(
    (targetFolder: WorkspaceFolder, payload: DragPayload) => {
      if (payload.kind === 'file') {
        void setFileFolderAssignment(payload.id, targetFolder.id);
        toast.success(`${payload.name} déplacé dans ${targetFolder.name}`);
      } else {
        if (payload.id === targetFolder.id) return;
        void movePageFolder(payload.id, targetFolder.id);
        toast.success(`${payload.name} déplacé dans ${targetFolder.name}`);
      }
    },
    [movePageFolder, setFileFolderAssignment],
  );

  const handleDropOnBreadcrumb = useCallback(
    (targetParentId: string | null, payload: DragPayload) => {
      if (payload.kind === 'file') {
        void setFileFolderAssignment(payload.id, targetParentId);
        toast.success(targetParentId ? `${payload.name} déplacé` : `${payload.name} retiré du classement`);
      } else {
        void movePageFolder(payload.id, targetParentId);
        toast.success(`${payload.name} déplacé`);
      }
    },
    [movePageFolder, setFileFolderAssignment],
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
            <h1 className='text-xl font-semibold leading-tight tracking-tight'>Workspace</h1>
            <p className='text-xs text-muted-foreground'>Organisez, classez et indexez vos documents au sein d'un workspace.</p>
          </div>
          <WorkspacePicker />
        </div>
      </div>

      {/* Toolbar */}
      <div className='border-b bg-card/40'>
        <div className='mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-6 py-3'>
          <div className='relative flex-1 min-w-[240px] max-w-md'>
            <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Rechercher dossier ou fichier…' className='pl-9 pr-9 h-9' />
            {search && (
              <button onClick={() => setSearch('')} className='absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted'>
                <X className='h-3.5 w-3.5' />
              </button>
            )}
          </div>

          <div className='ml-auto flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={() => setCreateOpen(true)} className='gap-1.5'>
              <FolderPlus className='h-4 w-4' />
              Nouveau dossier
            </Button>
            <Separator orientation='vertical' className='h-6' />
            <Button size='sm' className='gap-1.5' onClick={() => setClassifyOpen(true)}>
              <Sparkles className='h-4 w-4' />
              Classifier
            </Button>
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
          {visibleFolders.length === 0 && visibleFiles.length === 0 ? (
            <EmptyFolderState hasSearch={!!search} onCreateFolder={() => setCreateOpen(true)} />
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
                  <div className='space-y-1'>
                    {visibleFiles.map((file) => (
                      <FileRow key={file.id} file={file} onMove={() => setMapFile(file)} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateFolderDialog open={createOpen} onOpenChange={setCreateOpen} parentId={currentFolderId} />
      <EditFolderDialog open={!!editFolder} onOpenChange={(o) => !o && setEditFolder(null)} folder={editFolder} />
      <MoveFolderDialog open={!!moveFolderTarget} onOpenChange={(o) => !o && setMoveFolderTarget(null)} folder={moveFolderTarget} />
      <MoveFileDialog open={!!mapFile} onOpenChange={(o) => !o && setMapFile(null)} file={mapFile} />
      <ClassifyDialog open={classifyOpen} onOpenChange={setClassifyOpen} />
    </div>
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
  const [isOver, setIsOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ kind: 'folder', id: folder.id, name: folder.name }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasItemPayload(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  };

  const handleDrop = (e: React.DragEvent) => {
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
      <div className={cn('absolute left-4 top-0 h-2.5 w-20 rounded-t-md bg-secondary border border-b-0 transition-colors', borderClass)} />
      <div draggable onDragStart={handleDragStart} onDragEnd={() => setIsDragging(false)} onDragOver={handleDragOver} onDragLeave={() => setIsOver(false)} onDrop={handleDrop} className={cn('relative overflow-hidden rounded-md border bg-secondary transition-colors', 'cursor-grab active:cursor-grabbing', borderClass, isOver && 'ring-2 ring-primary/30')}>
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

        <div className='flex items-center justify-between border-t border-border/60 bg-background/30 px-4 py-2 text-xs text-muted-foreground'>
          <div className='flex items-center gap-3'>
            <span className='inline-flex items-center gap-1'>
              <Folder className='h-3 w-3' /> {childCount}
            </span>
            <span className='inline-flex items-center gap-1'>
              <FileIcon className='h-3 w-3' /> {fileCount}
            </span>
          </div>

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
        </div>
      </div>
    </div>
  );
}

function FileRow({ file, onMove }: { file: WorkspaceFile; onMove: () => void }) {
  const Icon = getFileIcon(file.mimeType);
  const [isDragging, setIsDragging] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const deleteDocument = useWorkspaceStore((s) => s.deleteDocument);
  const getDownloadUrl = useWorkspaceStore((s) => s.getDownloadUrl);
  const reindexDocument = useWorkspaceStore((s) => s.reindexDocument);
  const refreshPageData = useWorkspaceStore((s) => s.refreshPageData);

  const viewable = isViewableFile(file.mimeType);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ kind: 'file', id: file.id, name: file.name }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleView = useCallback(() => {
    if (!viewable) return;
    openFileViewer(file.workspaceId, file.id, file.name, file.mimeType);
  }, [file.id, file.mimeType, file.name, file.workspaceId, viewable]);

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
      await reindexDocument(file.workspaceId, file.id);
      toast.success(`${file.name} envoyé à l'indexation`);
    } catch {
      // toast handled by the store
    } finally {
      setIsReindexing(false);
    }
  }, [file.id, file.name, file.workspaceId, reindexDocument]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteDocument(file.workspaceId, file.id);
      setConfirmDeleteOpen(false);
      toast.success(`${file.name} supprimé`);
      await refreshPageData();
    } catch {
      // toast handled by the store
    } finally {
      setIsDeleting(false);
    }
  }, [deleteDocument, file.id, file.name, file.workspaceId, refreshPageData]);

  return (
    <>
      <div draggable onDragStart={handleDragStart} onDragEnd={() => setIsDragging(false)} className={cn('group flex items-center gap-4 rounded-md py-2 pl-2 pr-1 transition-colors', 'hover:bg-accent/50 cursor-grab active:cursor-grabbing', isDragging && 'opacity-50')}>
        <Icon className='h-5 w-5 shrink-0 text-muted-foreground' />

        <div className='min-w-0 flex-1 flex items-center gap-2'>
          <span className='truncate text-sm'>{file.name}</span>
        </div>

        <span className='hidden md:inline text-xs text-muted-foreground tabular-nums whitespace-nowrap'>{formatBytes(file.size)}</span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className='rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100' onPointerDown={(e) => e.stopPropagation()}>
              <MoreVertical className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {viewable && (
              <DropdownMenuItem onClick={handleView}>
                <Eye className='mr-2 h-4 w-4' /> Voir
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Download className='mr-2 h-4 w-4' />}
              Télécharger
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleReindex} disabled={isReindexing}>
              {isReindexing ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <RefreshCw className='mr-2 h-4 w-4' />}
              Indexer / Réindexer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMove}>
              <ArrowRight className='mr-2 h-4 w-4' /> Déplacer dans…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setConfirmDeleteOpen(true)}>
              <Trash2 className='mr-2 h-4 w-4' /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDeleteFileDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        fileName={file.name}
        isDeleting={isDeleting}
        onConfirm={handleDelete}
      />
    </>
  );
}

function ConfirmDeleteFileDialog({ open, onOpenChange, fileName, isDeleting, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; fileName: string; isDeleting: boolean; onConfirm: () => void | Promise<void> }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !isDeleting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer le fichier</DialogTitle>
          <DialogDescription>
            Voulez-vous vraiment supprimer <span className='font-medium text-foreground'>{fileName}</span> ? Cette action est irréversible.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Annuler
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isDeleting} className='gap-1.5'>
            {isDeleting ? <Loader2 className='h-4 w-4 animate-spin' /> : <Trash2 className='h-4 w-4' />}
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyFolderState({ hasSearch, onCreateFolder }: { hasSearch: boolean; onCreateFolder: () => void }) {
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
      <p className='mt-1 max-w-sm text-sm text-muted-foreground'>Créez un dossier pour structurer votre classification ou utilisez la zone d'upload ci-dessus pour ajouter des fichiers.</p>
      <div className='mt-5 flex items-center gap-2'>
        <Button variant='outline' onClick={onCreateFolder} className='gap-1.5'>
          <FolderPlus className='h-4 w-4' />
          Nouveau dossier
        </Button>
      </div>
    </div>
  );
}

function EmptyWorkspaceState() {
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
          <p className='text-xs text-muted-foreground'>Sélectionnez un workspace pour commencer.</p>
        </div>

        <div className='flex items-center justify-center gap-x-5 gap-y-2 flex-wrap pt-2 text-xs text-muted-foreground'>
          <InfoItem icon={<FolderPlus className='h-3.5 w-3.5' />} label='Hiérarchie décrite' />
          <InfoItem icon={<Link2 className='h-3.5 w-3.5' />} label='Drag & drop' />
          <InfoItem icon={<Sparkles className='h-3.5 w-3.5' />} label='Playbook IA' />
        </div>
      </div>
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
