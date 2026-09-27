import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { getDocuments, getFolderContents } from '@/modules/workspace/api';
import type { WorkspaceDocument } from '@/modules/workspace/types';
import { isMappableDocument, isStructuredDocument } from '../knowledge/KnowledgePanel';

/** Picked folders (every file inside, at any depth) and single files. Nothing picked means the whole workspace. */
export interface WorkspacePick {
  folderIds: string[];
  documentIds: string[];
}

type Page = { items: WorkspaceDocument[]; page: number; totalPages: number };

export const isReadableDocument = (mimeType: string) => isMappableDocument(mimeType) && !isStructuredDocument(mimeType);

/**
 * What a workspace source covers: every file of the workspace, or the folders and files picked in its tree.
 * A picked folder covers what is inside it, so its content shows as included rather than as separate picks.
 */
export function WorkspaceFilePicker({ workspaceId, name, whole, pick, onChange }: Readonly<{
  workspaceId: string;
  name: string;
  whole: boolean;
  pick: WorkspacePick;
  onChange: (next: { whole: boolean; pick: WorkspacePick }) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rootKey = '';

  const load = async (folderId: string, page: number) => {
    setLoading((current) => new Set(current).add(folderId));
    try {
      const result = folderId ? await getFolderContents(workspaceId, folderId, { limit: 50, page }) : await getDocuments(workspaceId, { limit: 50, page });
      setPages((current) => ({ ...current, [folderId]: {
        items: page === 1 ? result.documents : [...(current[folderId]?.items ?? []), ...result.documents.filter((item) => !current[folderId]?.items.some((known) => known.id === item.id))],
        page, totalPages: result.pagination.totalPages,
      } }));
    } catch {
      if (page === 1) setPages((current) => ({ ...current, [folderId]: { items: [], page: 1, totalPages: 1 } }));
    } finally {
      setLoading((current) => { const next = new Set(current); next.delete(folderId); return next; });
    }
  };
  useEffect(() => {
    setPages({});
    setOpen(new Set());
    if (!whole) void load(rootKey, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  useEffect(() => { if (!whole && !pages[rootKey] && !loading.has(rootKey)) void load(rootKey, 1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [whole]);

  const folders = new Set(pick.folderIds);
  const documents = new Set(pick.documentIds);
  const toggle = (item: WorkspaceDocument, checked: boolean) => {
    const target = item.isFolder ? new Set(folders) : new Set(documents);
    if (checked) target.add(item.id); else target.delete(item.id);
    onChange({ whole: false, pick: item.isFolder ? { folderIds: [...target], documentIds: pick.documentIds } : { folderIds: pick.folderIds, documentIds: [...target] } });
  };
  const toggleOpen = (folderId: string) => {
    setOpen((current) => { const next = new Set(current); if (next.has(folderId)) next.delete(folderId); else next.add(folderId); return next; });
    if (!pages[folderId] && !loading.has(folderId)) void load(folderId, 1);
  };

  const renderLevel = (folderId: string, depth: number, covered: boolean) => {
    const page = pages[folderId];
    if (loading.has(folderId) && !page?.items.length) return <div className='flex justify-center p-2'><Loader2 className='h-4 w-4 animate-spin text-primary' /></div>;
    if (!page?.items.length) return <p className='p-2 text-xs text-muted-foreground' style={{ paddingLeft: `${8 + depth * 16}px` }}>{t('knowledge.noDocuments')}</p>;
    return <>
      {page.items.map((item) => {
        const label = item.isFolder ? item.folderName ?? item.originalName : item.originalName;
        const readable = item.isFolder || isReadableDocument(item.mimeType);
        const picked = item.isFolder ? folders.has(item.id) : documents.has(item.id);
        const expanded = open.has(item.id);
        return <div key={item.id}>
          <div className='flex min-h-9 items-center gap-1.5 rounded-lg pr-2 text-xs hover:bg-muted/60' style={{ paddingLeft: `${4 + depth * 16}px` }}>
            {item.isFolder
              ? <button type='button' className='flex h-7 w-6 shrink-0 items-center justify-center rounded' onClick={() => toggleOpen(item.id)} aria-label={expanded ? t('knowledge.collapseWorkspace', { name: label }) : t('knowledge.expandWorkspace', { name: label })}>{expanded ? <ChevronDown className='h-3.5 w-3.5' /> : <ChevronRight className='h-3.5 w-3.5' />}</button>
              : <span className='w-6 shrink-0' />}
            <input type='checkbox' className='shrink-0' disabled={covered || !readable} checked={covered || picked} onChange={(event) => toggle(item, event.target.checked)}
              aria-label={t(item.isFolder ? 'mapping.pickFolder' : 'mapping.pickFile', { name: label })} />
            {item.isFolder ? <Folder className='h-3.5 w-3.5 shrink-0 text-primary' /> : <FileText className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />}
            <span className={`min-w-0 flex-1 truncate ${readable ? '' : 'text-muted-foreground'}`}>{label}</span>
            {!readable && <span className='shrink-0 text-[10px] text-muted-foreground'>{t('knowledge.notReadable')}</span>}
          </div>
          {item.isFolder && expanded && renderLevel(item.id, depth + 1, covered || picked)}
        </div>;
      })}
      {page.page < page.totalPages && <Button type='button' variant='ghost' size='sm' className='w-full text-xs' disabled={loading.has(folderId)} onClick={() => void load(folderId, page.page + 1)}>{t('action.loadMore')}</Button>}
    </>;
  };

  const count = pick.folderIds.length + pick.documentIds.length;
  const folderCount = pick.folderIds.length, fileCount = pick.documentIds.length;
  const pickedParts = [
    ...(folderCount ? [t(folderCount === 1 ? 'mapping.pickedFolders_one' : 'mapping.pickedFolders_other', { count: folderCount })] : []),
    ...(fileCount ? [t(fileCount === 1 ? 'mapping.pickedFiles_one' : 'mapping.pickedFiles_other', { count: fileCount })] : []),
  ];
  return <div className='space-y-2'>
    <div role='radiogroup' aria-label={t('mapping.coverage')} className='grid gap-1.5 sm:grid-cols-2'>
      {[true, false].map((option) => <label key={String(option)} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs ${whole === option ? 'border-teal-500 bg-teal-500/10' : 'hover:bg-muted/60'}`}>
        <input type='radio' name='workspace-coverage' className='mt-0.5' checked={whole === option} onChange={() => onChange({ whole: option, pick })} />
        <span><span className='block font-medium'>{option ? t('mapping.coverWhole') : t('mapping.coverPicked')}</span>
          <span className='text-muted-foreground'>{option ? t('mapping.coverWholeHelp', { name }) : t('mapping.coverPickedHelp')}</span></span>
      </label>)}
    </div>
    {!whole && <>
      <div className='max-h-64 overflow-y-auto rounded-xl border bg-background p-1.5'>{renderLevel(rootKey, 0, false)}</div>
      <p className={`text-xs ${count ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}>
        {count ? t('mapping.pickedSummary', { items: pickedParts.join(t('mapping.pickedAnd')) }) : t('mapping.pickNothing')}
      </p>
    </>}
  </div>;
}
