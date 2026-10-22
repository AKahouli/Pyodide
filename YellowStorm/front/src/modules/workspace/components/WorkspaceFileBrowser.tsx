import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, AlertCircle, FileText, Folder, FolderOpen, Home, Loader2, MoreVertical, Move, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApiAction } from '@/lib/use-api-action';
import { showSuccess, showWarning } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { INDEXING_TONE, statusFilterTone } from './indexing-status-tone';
import { useCanWriteWorkspace, useWorkspaceStore } from '../store';
import * as pageApi from '../page-api';
import * as api from '../api';
import { readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';
import type { WorkspaceArtifact, WorkspaceFile, WorkspaceFolder } from '../types';

export interface FileRowSelection {
  selected: boolean;
  batchMode: boolean;
  disabled: boolean;
  onToggle: (range: boolean) => void;
  onMove?: () => void;
}

type Item = { kind: 'file'; value: WorkspaceFile } | { kind: 'folder'; value: WorkspaceFolder };
type View = 'folder' | 'all' | 'attention';
type Operation = 'move' | 'delete' | 'index';
const PAGE_SIZE = 25;
const keyOf = (item: Item) => `${item.kind}:${item.value.id}`;

type Props = {
  workspaceId: string;
  folders: WorkspaceFolder[];
  files: WorkspaceFile[];
  artifacts: WorkspaceArtifact[];
  currentFolderId: string | null;
  search: string;
  onSearch: (search: string) => void;
  onNavigate: (id: string | null) => void;
  onEditFolder: (folder: WorkspaceFolder) => void;
  renderFile: (file: WorkspaceFile, selection: FileRowSelection) => ReactNode;
};

export function WorkspaceFileBrowser({ workspaceId, folders, files, artifacts, currentFolderId, search, onSearch, onNavigate, onEditFolder, renderFile }: Props) {
  const { t } = useModuleTranslation('workspace');
  const canWrite = useCanWriteWorkspace();
  const refreshPageData = useWorkspaceStore(s => s.refreshPageData);
  const [view, setView] = useState<View>('folder');
  const [status, setStatus] = useState('all');
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mobileFolders, setMobileFolders] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<{ success: number; failed: number } | null>(null);
  const anchor = useRef<string | null>(null);
  const shift = useRef(false);
  const working = useRef(false);

  const workspaceFolders = useMemo(() => folders.filter(f => f.workspaceId === workspaceId), [folders, workspaceId]);
  const workspaceFiles = useMemo(() => files.filter(f => f.workspaceId === workspaceId), [files, workspaceId]);
  const allItems = useMemo<Item[]>(() => [...workspaceFolders.map(value => ({ kind: 'folder' as const, value })), ...workspaceFiles.map(value => ({ kind: 'file' as const, value }))], [workspaceFolders, workspaceFiles]);
  const matching = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return allItems.filter(item => {
      if (view !== 'folder' && item.kind === 'folder') return false;
      if (view === 'folder' && (item.kind === 'folder' ? item.value.parentId : item.value.folderId) !== currentFolderId) return false;
      if (view === 'attention' && item.kind === 'file' && item.value.indexingStatus !== 'failed' && item.value.status !== 'failed') return false;
      if (status !== 'all' && (item.kind === 'folder' || (item.value.indexingStatus ?? 'none') !== status)) return false;
      return !query || item.value.name.toLocaleLowerCase().includes(query) || (item.kind === 'file' && artifacts.some(a => a.primarySource.documentId === item.value.id && a.name.toLocaleLowerCase().includes(query)));
    }).sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || (ascending ? 1 : -1) * a.value.name.localeCompare(b.value.name));
  }, [allItems, artifacts, currentFolderId, search, view, status, ascending]);
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = matching.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const picked = allItems.filter(item => selected.has(keyOf(item)));
  const allPageSelected = visible.length > 0 && visible.every(item => selected.has(keyOf(item)));
  const somePageSelected = visible.some(item => selected.has(keyOf(item)));
  const attentionCount = workspaceFiles.filter(f => f.indexingStatus === 'failed' || f.status === 'failed').length;
  const eligibleFiles = picked.filter((item): item is Extract<Item, { kind: 'file' }> => item.kind === 'file' && !['pending', 'processing'].includes(item.value.indexingStatus ?? '') && !['pending', 'uploading', 'processing', 'failed'].includes(item.value.status ?? ''));
  const linkedCount = artifacts.filter(a => picked.some(item => item.kind === 'file' && item.value.id === a.primarySource.documentId)).length;
  const folderTrail: WorkspaceFolder[] = [];
  let trailId = currentFolderId;
  const trailSeen = new Set<string>();
  while (trailId && !trailSeen.has(trailId)) { trailSeen.add(trailId); const folder = workspaceFolders.find(f => f.id === trailId); if (!folder) break; folderTrail.unshift(folder); trailId = folder.parentId; }

  useEffect(() => { setSelected(new Set()); setPage(0); anchor.current = null; setOutcome(null); }, [currentFolderId, workspaceId]);

  function resetSelection() { setSelected(new Set()); anchor.current = null; setPage(0); setOutcome(null); }
  function navigate(id: string | null) { if (working.current) return; resetSelection(); setView('folder'); setStatus('all'); onSearch(''); onNavigate(id); setMobileFolders(false); }
  function changeView(next: View) { if (working.current) return; resetSelection(); setView(next); setStatus('all'); onSearch(''); onNavigate(null); setMobileFolders(false); }
  function toggle(item: Item, range: boolean) {
    if (working.current || !canWrite) return;
    const key = keyOf(item);
    const to = matching.findIndex(i => keyOf(i) === key);
    const from = matching.findIndex(i => keyOf(i) === anchor.current);
    setSelected(previous => {
      const next = new Set(previous);
      const add = !next.has(key);
      const targets = range && from >= 0 ? matching.slice(Math.min(from, to), Math.max(from, to) + 1) : [item];
      for (const target of targets) add ? next.add(keyOf(target)) : next.delete(keyOf(target));
      return next;
    });
    anchor.current = key;
  }
  const blockedDestinations = useMemo(() => {
    const blocked = new Set(picked.filter(item => item.kind === 'folder').map(item => item.value.id));
    let added = true;
    while (added) { added = false; for (const folder of workspaceFolders) if (folder.parentId && blocked.has(folder.parentId) && !blocked.has(folder.id)) { blocked.add(folder.id); added = true; } }
    return blocked;
  }, [picked, workspaceFolders]);
  function folderPath(id: string | null) {
    const names: string[] = [];
    const seen = new Set<string>();
    while (id && !seen.has(id)) { seen.add(id); const folder = workspaceFolders.find(f => f.id === id); if (!folder) break; names.unshift(folder.name); id = folder.parentId; }
    return [t('explorer.root'), ...names].join(' / ');
  }

  const batchAction = useApiAction(async (action: Operation, target: string | null) => {
    if (!canWrite || working.current || picked.length === 0) return;
    working.current = true;
    // Capture identities and destination before asynchronous work. Refresh once;
    // the optimistic single-item store actions cannot safely run concurrently.
    const snapshot = action === 'index' ? eligibleFiles : picked;
    const failed = new Set<string>();
    let succeeded = 0;
    setProgress({ done: 0, total: snapshot.length });
    try {
      for (const item of snapshot) {
        try {
          if (action === 'move') {
            if (item.kind === 'folder') await pageApi.moveFolder(item.value.id, target);
            else await pageApi.assignFileToFolder(workspaceId, item.value.id, target);
          } else if (action === 'delete') {
            if (item.kind === 'folder') await pageApi.deleteFolder(item.value.id);
            else await api.deleteDocument(workspaceId, item.value.id, true);
          } else if (item.kind === 'file') await api.reindexDocument(workspaceId, item.value.id, readDeepSearchIndexationValue());
          succeeded++;
        } catch { failed.add(keyOf(item)); }
        setProgress({ done: succeeded + failed.size, total: snapshot.length });
      }
      // Do not refresh a workspace the user left while a request was pending.
      if (useWorkspaceStore.getState().selectedWorkspaceId === workspaceId) await refreshPageData();
      setSelected(failed);
      setOutcome({ success: succeeded, failed: failed.size });
      setOperation(null);
      const text = t('explorer.batchResult', { success: succeeded, failed: failed.size });
      if (failed.size) showWarning(text); else showSuccess(text);
    } finally { working.current = false; setProgress(null); }
  });
  const busy = batchAction.isLoading || !!progress;

  function renderTree(parentId: string | null, ancestors = new Set<string>()): ReactNode {
    return workspaceFolders.filter(f => f.parentId === parentId && !ancestors.has(f.id)).sort((a, b) => a.name.localeCompare(b.name)).map(folder => {
      const children = workspaceFolders.some(f => f.parentId === folder.id);
      const isCollapsed = collapsed.has(folder.id);
      return <li key={folder.id}>
        <div className={cn('flex min-w-0 items-center rounded-md', view === 'folder' && currentFolderId === folder.id && 'bg-primary/10 text-primary')}>
          <Button variant='ghost' size='icon' className='h-7 w-6 shrink-0' disabled={!children || busy} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id); return next; })} aria-label={t(isCollapsed ? 'explorer.expandFolder' : 'explorer.collapseFolder', { name: folder.name })} aria-expanded={children ? !isCollapsed : undefined}>
            {children && <ChevronRight className={cn('h-3 w-3 rtl:rotate-180', !isCollapsed && 'rotate-90 rtl:rotate-90')} />}
          </Button>
          <button type='button' disabled={busy} onClick={() => navigate(folder.id)} aria-current={view === 'folder' && currentFolderId === folder.id ? 'page' : undefined} className='flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pe-2 text-start text-sm hover:bg-accent'>
            {currentFolderId === folder.id && view === 'folder' ? <FolderOpen className='h-4 w-4 shrink-0' /> : <Folder className='h-4 w-4 shrink-0' />}<span className='truncate' title={folder.name}>{folder.name}</span>
          </button>
        </div>
        {children && !isCollapsed && <ul className='ms-3 border-s ps-1'>{renderTree(folder.id, new Set([...ancestors, folder.id]))}</ul>}
      </li>;
    });
  }

  return <div className='flex min-h-0 flex-1 flex-col md:flex-row'>
    <div className='border-b px-3 py-2 md:hidden'><Button variant='ghost' size='sm' className='gap-2' aria-expanded={mobileFolders} onClick={() => setMobileFolders(!mobileFolders)}><FolderOpen className='h-4 w-4' />{t('explorer.folders')}<ChevronDown className='h-3 w-3' /></Button></div>
    <aside aria-label={t('explorer.folderNavigation')} className={cn('w-full shrink-0 border-b bg-muted/20 p-3 md:w-52 md:overflow-y-auto md:border-b-0 md:border-e lg:w-60', !mobileFolders && 'hidden md:block')}>
      <nav className='space-y-1'>
        <Button variant='ghost' disabled={busy} onClick={() => changeView('all')} className={cn('w-full justify-start gap-2', view === 'all' && 'bg-accent')}><FileText className='h-4 w-4' />{t('explorer.allFiles')}<span className='ms-auto text-xs text-muted-foreground'>{workspaceFiles.length}</span></Button>
        <Button variant='ghost' disabled={busy} onClick={() => changeView('attention')} className={cn('w-full justify-start gap-2', view === 'attention' && 'bg-accent')}><AlertCircle className={cn('h-4 w-4', attentionCount > 0 && INDEXING_TONE.failed.text)} />{t('explorer.attention')}<span className={cn('ms-auto text-xs', attentionCount > 0 ? INDEXING_TONE.failed.text : 'text-muted-foreground')}>{attentionCount}</span></Button>
        <p className='px-2 pb-2 pt-6 text-xs font-medium text-muted-foreground'>{t('explorer.folders')}</p>
        <Button variant='ghost' disabled={busy} onClick={() => navigate(null)} aria-current={view === 'folder' && !currentFolderId ? 'page' : undefined} className={cn('w-full justify-start gap-2', view === 'folder' && !currentFolderId && 'bg-primary/10 text-primary')}><Home className='h-4 w-4' />{t('explorer.root')}</Button>
        <ul>{renderTree(null)}</ul>
      </nav>
    </aside>
    <section className='min-w-0 flex-1 overflow-y-auto p-3 md:p-5' aria-label={t('explorer.filesAndFolders')} aria-busy={busy}>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'><nav aria-label={t('explorer.breadcrumbs')} className='flex min-w-0 flex-wrap items-center gap-1'>{view === 'folder' ? <><button type='button' className='rounded px-1 py-1 hover:bg-accent hover:text-foreground' disabled={busy} onClick={() => navigate(null)}>{t('explorer.root')}</button>{folderTrail.map((folder, i) => <span key={folder.id} className='flex min-w-0 items-center gap-1'><ChevronRight className='h-3 w-3 shrink-0 rtl:rotate-180' /><button type='button' disabled={busy} aria-current={i === folderTrail.length - 1 ? 'page' : undefined} className='max-w-48 truncate rounded px-1 py-1 hover:bg-accent hover:text-foreground' onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}</> : t(view === 'all' ? 'explorer.allFiles' : 'explorer.attention')}</nav><span>{t('explorer.itemCount', { count: matching.length })}</span></div>
      <div className='mb-4 flex flex-wrap gap-2'>
        <div className='relative min-w-40 flex-1'><Search className='pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted-foreground' /><Input aria-label={t('explorer.search')} placeholder={t(view === 'folder' ? 'explorer.searchFolder' : 'explorer.searchWorkspace')} value={search} disabled={busy} onChange={e => { resetSelection(); onSearch(e.target.value); }} className='h-9 ps-9' /></div>
        <label className='relative flex h-9 items-center'>
          <span aria-hidden='true' className={cn('pointer-events-none absolute start-3 size-2 rounded-full', INDEXING_TONE[statusFilterTone(status)].dot)} />
          <select className='h-9 max-w-full rounded-md border bg-background py-0 pe-3 ps-7 text-sm' aria-label={t('explorer.statusFilter')} value={status} disabled={busy} onChange={e => { resetSelection(); setStatus(e.target.value); }}><option value='all'>{t('explorer.allStatuses')}</option>{(['none', 'pending', 'processing', 'ready', 'failed'] as const).map(s => <option key={s} value={s} className={INDEXING_TONE[statusFilterTone(s)].text}>{t(`explorer.status.${s}`)}</option>)}</select>
        </label>
      </div>
      {picked.length > 0 && <div className='mb-3 rounded-md bg-primary/10 p-2' aria-label={t('explorer.batchActions')}>
        <div className='flex flex-wrap items-center gap-1'><strong className='me-auto px-2 text-sm font-medium'>{t('explorer.selected', { count: picked.length })}</strong>
          <Button variant='ghost' size='sm' disabled={busy || !canWrite} onClick={() => { setDestination(currentFolderId); setOperation('move'); }}><Move className='me-2 h-4 w-4' />{t('explorer.move')}</Button>
          <Button variant='ghost' size='sm' disabled={busy || !canWrite || !eligibleFiles.length} onClick={() => setOperation('index')}><RefreshCw className='me-2 h-4 w-4' />{t('explorer.index')}</Button>
          <Button variant='ghost' size='sm' className='text-destructive hover:text-destructive' disabled={busy || !canWrite} onClick={() => setOperation('delete')}><Trash2 className='me-2 h-4 w-4' />{t('explorer.delete')}</Button>
          <Button variant='ghost' size='icon' disabled={busy} onClick={() => setSelected(new Set())} aria-label={t('explorer.clearSelection')}><X className='h-4 w-4' /></Button>
        </div>
        <div className='flex flex-wrap items-center gap-1 px-2 text-xs text-muted-foreground'>{picked.length < matching.length ? <Button variant='link' size='sm' disabled={busy} className='h-auto whitespace-normal px-0 text-start text-xs' onClick={() => setSelected(new Set(matching.map(keyOf)))}>{t('explorer.selectMatching', { count: matching.length })}</Button> : t('explorer.allMatchingSelected', { count: picked.length })}</div>
      </div>}
      {progress && <p className='mb-3 flex items-center gap-2 text-sm' role='status'><Loader2 className='h-4 w-4 animate-spin' />{t('explorer.progress', progress)}</p>}
      {outcome && <p className={cn('mb-3 text-sm', outcome.failed ? 'text-destructive' : 'text-muted-foreground')} role='status'>{t('explorer.batchResult', outcome)}{outcome.failed > 0 && ` ${t('explorer.failedRemainSelected')}`}</p>}
      <Table className='table-fixed' aria-label={t('explorer.filesAndFolders')}><TableHeader><TableRow>
        {canWrite && <TableHead className='w-10'><Checkbox aria-label={t('explorer.selectPage')} checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false} disabled={busy || !visible.length} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); visible.forEach(item => checked ? next.add(keyOf(item)) : next.delete(keyOf(item))); return next; })} /></TableHead>}
        <TableHead aria-sort={ascending ? 'ascending' : 'descending'}><Button variant='ghost' size='sm' className='h-8 px-0' onClick={() => setAscending(!ascending)}>{t('explorer.name')}{ascending ? <ArrowUp className='ms-1 h-3 w-3' /> : <ArrowDown className='ms-1 h-3 w-3' />}</Button></TableHead>
        <TableHead className='hidden w-36 sm:table-cell'>{t('explorer.indexingStatus')}</TableHead><TableHead className='hidden w-20 text-end lg:table-cell'>{t('explorer.size')}</TableHead><TableHead className='hidden w-28 text-end xl:table-cell'>{t('explorer.modified')}</TableHead><TableHead className='w-10'><span className='sr-only'>{t('explorer.actions')}</span></TableHead>
      </TableRow></TableHeader><TableBody>
        {visible.map(item => item.kind === 'file' ? renderFile(item.value, { selected: selected.has(keyOf(item)), batchMode: picked.length > 0, disabled: busy, onToggle: range => toggle(item, range), onMove: () => { setSelected(new Set([keyOf(item)])); setDestination(item.value.folderId); setOperation('move'); } }) : <TableRow key={keyOf(item)} data-state={selected.has(keyOf(item)) ? 'selected' : undefined}>
          {canWrite && <TableCell><Checkbox aria-label={t('explorer.selectItem', { name: item.value.name })} checked={selected.has(keyOf(item))} disabled={busy} onClick={e => { shift.current = e.shiftKey; }} onCheckedChange={() => { toggle(item, shift.current); shift.current = false; }} /></TableCell>}
          <TableCell><button type='button' disabled={busy} className='flex w-full min-w-0 items-center gap-2 py-1 text-start hover:underline' onClick={() => navigate(item.value.id)}><Folder className='h-4 w-4 shrink-0 text-primary' /><span className='truncate' title={item.value.name}>{item.value.name}</span></button></TableCell>
          <TableCell className='hidden text-xs text-muted-foreground sm:table-cell'>{t('explorer.folder')}</TableCell><TableCell className='hidden lg:table-cell' /><TableCell className='hidden xl:table-cell' /><TableCell>{canWrite && <DropdownMenu><DropdownMenuTrigger asChild><Button variant='ghost' size='icon' className='h-8 w-8' disabled={busy || picked.length > 0} aria-label={t('explorer.itemActions', { name: item.value.name })}><MoreVertical className='h-4 w-4' /></Button></DropdownMenuTrigger><DropdownMenuContent align='end'><DropdownMenuItem onClick={() => onEditFolder(item.value)}><Pencil className='me-2 h-4 w-4' />{t('explorer.rename')}</DropdownMenuItem><DropdownMenuItem onClick={() => { setSelected(new Set([keyOf(item)])); setDestination(item.value.parentId); setOperation('move'); }}><Move className='me-2 h-4 w-4' />{t('explorer.move')}</DropdownMenuItem><DropdownMenuItem className='text-destructive' onClick={() => { setSelected(new Set([keyOf(item)])); setOperation('delete'); }}><Trash2 className='me-2 h-4 w-4' />{t('explorer.delete')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</TableCell>
        </TableRow>)}
        {!matching.length && <TableRow><TableCell colSpan={canWrite ? 6 : 5} className='py-16 text-center text-muted-foreground'><FolderOpen className='mx-auto mb-3 h-7 w-7' /><p>{t(search || status !== 'all' ? 'explorer.noMatches' : view === 'attention' ? 'explorer.noAttention' : 'explorer.emptyFolder')}</p></TableCell></TableRow>}
      </TableBody></Table>
      <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground'><span>{t('explorer.pagination', { from: matching.length ? safePage * PAGE_SIZE + 1 : 0, to: Math.min((safePage + 1) * PAGE_SIZE, matching.length), count: matching.length })}</span><div className='flex gap-1'><Button variant='ghost' size='sm' disabled={safePage === 0 || busy} onClick={() => setPage(safePage - 1)}><ChevronLeft className='me-1 h-4 w-4 rtl:rotate-180' />{t('explorer.previous')}</Button><Button variant='ghost' size='sm' disabled={safePage === pageCount - 1 || busy} onClick={() => setPage(safePage + 1)}>{t('explorer.next')}<ChevronRight className='ms-1 h-4 w-4 rtl:rotate-180' /></Button></div></div>
    </section>
    <Dialog open={!!operation} onOpenChange={open => { if (!open && !busy) setOperation(null); }}><DialogContent className='sm:max-w-lg'><DialogHeader><DialogTitle>{t(`explorer.confirm.${operation ?? 'move'}`)}</DialogTitle><DialogDescription>{operation === 'delete' ? <>{t('explorer.deleteWarning', { count: picked.filter(item => item.kind === 'file').length })}{picked.some(item => item.kind === 'folder') && <span className='mt-2 block'>{t('explorer.folderDeleteWarning')}</span>}{linkedCount > 0 && <span className='mt-2 block font-medium text-destructive'>{t('artifacts.sourceDeleteWarning', { count: linkedCount })}</span>}</> : operation === 'index' ? t('explorer.indexScope', { count: eligibleFiles.length, skipped: picked.length - eligibleFiles.length }) : t('explorer.moveScope', { count: picked.length })}</DialogDescription></DialogHeader>
      {operation === 'move' && <label className='grid min-w-0 gap-2 text-sm'>{t('explorer.destination')}<select className='w-full rounded-md border bg-background p-2' aria-label={t('explorer.destination')} value={destination ?? ''} disabled={busy} onChange={e => setDestination(e.target.value || null)}><option value=''>{t('explorer.root')}</option>{workspaceFolders.filter(f => !blockedDestinations.has(f.id)).map(f => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>)}</select></label>}
      <DialogFooter><Button variant='outline' disabled={busy} onClick={() => setOperation(null)}>{t('explorer.cancel')}</Button><Button variant={operation === 'delete' ? 'destructive' : 'default'} disabled={busy || !canWrite || !picked.length || (operation === 'index' && !eligibleFiles.length) || (operation === 'move' && !!destination && blockedDestinations.has(destination))} onClick={() => { if (operation) void batchAction.execute(operation, destination); }}>{busy && <Loader2 className='me-2 h-4 w-4 animate-spin' />}{t(operation === 'move' ? 'explorer.moveHere' : operation === 'index' ? 'explorer.index' : 'explorer.deletePermanently')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
