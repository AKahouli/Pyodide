import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileSpreadsheet, FileText, Loader2, Search, Share2, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { getSharedWorkspaces, getWorkspaces } from '@/modules/workspace/api';
import type { Workspace } from '@/modules/workspace/types';
import { semanticModelApi } from '../../api';
import type { SourceFileMatch, SourceSuggestionOption } from '../../types';
import { isReadableDocument, WorkspaceFilePicker, type WorkspacePick } from '../mapping/WorkspaceFilePicker';
import { isStructuredDocument } from '../knowledge/KnowledgePanel';
import { HelpTip, INPUT, ROW_LIST, SectionHeader } from '../form/FormParts';

type WorkspaceRow = { id: string; name: string; documentCount: number; shared: boolean };

/** What is chosen so far: a whole workspace, folders and files in it, or one spreadsheet. */
type Choice = {
  workspaceId: string;
  workspaceName: string;
  whole: boolean;
  pick: WorkspacePick;
  names: Record<string, string>;
  mimeTypes?: Record<string, string>;
  spreadsheet?: { id: string; name: string; mimeType: string };
};

const MIN_FILE_SEARCH = 2;

/** The choice, in the shape of a suggestion, so the designer opens it the same way. */
export function choiceToOption(choice: Choice): SourceSuggestionOption {
  const base = { workspaceId: choice.workspaceId, workspaceName: choice.workspaceName, fileCount: 0, stillIndexing: 0, reason: '' };
  if (choice.spreadsheet) {
    return { ...base, kind: 'spreadsheet', folderIds: [], documentIds: [choice.spreadsheet.id], folders: [], documents: [choice.spreadsheet.name], mimeType: choice.spreadsheet.mimeType };
  }
  if (choice.whole) return { ...base, kind: 'workspace', folderIds: [], documentIds: [], folders: [], documents: [] };
  return {
    ...base, kind: 'documents', folderIds: choice.pick.folderIds, documentIds: choice.pick.documentIds,
    folders: choice.pick.folderIds.map((id) => choice.names[id]).filter(Boolean),
    documents: choice.pick.documentIds.map((id) => choice.names[id]).filter(Boolean),
  };
}

/** In `file` mode the tree picks one file: the one just ticked replaces the one before. */
function onePick(current: WorkspacePick, next: WorkspacePick): WorkspacePick {
  const added = next.documentIds.find((id) => !current.documentIds.includes(id));
  return { folderIds: [], documentIds: added ? [added] : next.documentIds.slice(-1) };
}

/** The one file chosen, with its type, or the whole workspace. */
function oneFile(choice: Choice): SourceSuggestionOption {
  const option = choiceToOption(choice);
  const [id] = option.documentIds;
  return option.kind === 'documents' && id ? { ...option, kind: 'document', mimeType: choice.mimeTypes?.[id] } : option;
}

function isComplete(choice: Choice | null): choice is Choice {
  return Boolean(choice && (choice.spreadsheet || choice.whole || choice.pick.folderIds.length || choice.pick.documentIds.length));
}

/**
 * What can be chosen: `source` (a semantic model source: one spreadsheet alone, or readable files and folders),
 * `files` (any files, or a whole workspace), `file` (one file, or a whole workspace) or `workspace` (one workspace).
 */
export type SourceChooserMode = 'source' | 'files' | 'file' | 'workspace';

/**
 * Every workspace the person can open, in a list they scroll and search, to choose the source of one concept
 * themselves. Searching also finds files by name in all of them. Nothing is connected here: the choice opens
 * in the designer, which shows what will be read before it is saved.
 */
export function SourceChooserDialog({ open, modelId, conceptLabel, onClose, onChoose, mode = 'source', searchFiles, title, description, useLabel, initialSearch = '' }: Readonly<{
  open: boolean;
  /** The model whose file search is used, unless `searchFiles` is given. */
  modelId?: string;
  conceptLabel: string;
  onClose: () => void;
  onChoose: (option: SourceSuggestionOption) => void;
  mode?: SourceChooserMode;
  searchFiles?: (term: string) => Promise<{ files: SourceFileMatch[] }>;
  title?: string;
  description?: string;
  useLabel?: string;
  /** What the search starts with, such as the name a suggestion quoted. */
  initialSearch?: string;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch(initialSearch); setTerm(initialSearch.trim()); setChoice(null); setExpanded(null); setReplaced(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const [workspacePages, setWorkspacePages] = useState(1);
  useEffect(() => setWorkspacePages(1), [term]);
  const workspaces = useQuery({
    queryKey: ['semantic-model', 'source-chooser', 'workspaces', term, workspacePages],
    enabled: open,
    queryFn: async (): Promise<{ rows: WorkspaceRow[]; more: boolean }> => {
      const [own, shared] = await Promise.all([
        getWorkspaces({ limit: 50 * workspacePages, page: 1, search: term || undefined, sortBy: 'name', sortOrder: 'asc' }),
        getSharedWorkspaces({ limit: 100, search: term || undefined }).catch(() => ({ workspaces: [] as unknown[] })),
      ]);
      const ownIds = new Set(own.workspaces.map((workspace) => workspace.id));
      const lower = term.toLowerCase();
      const sharedRows = (shared.workspaces as Workspace[])
        .filter((workspace) => !ownIds.has(workspace.id) && (!lower || workspace.name.toLowerCase().includes(lower)))
        .map((workspace) => ({ id: workspace.id, name: workspace.name, documentCount: workspace.documentCount ?? 0, shared: true }));
      return {
        rows: [...own.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, documentCount: workspace.documentCount ?? 0, shared: false })), ...sharedRows],
        more: own.pagination.totalPages > 1,
      };
    },
    placeholderData: (previous) => previous,
  });
  const findsFiles = mode !== 'workspace';
  const files = useQuery({
    queryKey: ['semantic-model', 'source-chooser', 'files', modelId ?? 'any', mode, term],
    enabled: open && findsFiles && term.length >= MIN_FILE_SEARCH,
    queryFn: () => searchFiles ? searchFiles(term) : semanticModelApi.searchSourceFiles(modelId ?? '', term),
  });
  /** A spreadsheet is a source on its own only for a semantic model; elsewhere it is a file like any other. */
  const isSheet = (file: Pick<SourceFileMatch, 'kind' | 'mimeType'>) => mode === 'source' && (file.kind === 'spreadsheet' || isStructuredDocument(file.mimeType));

  /** A source covers one workspace: picking in another one starts over there, and says so. */
  const inWorkspace = (workspace: { id: string; name: string }, next: (current: Choice) => Choice) => {
    if (choice?.workspaceId !== workspace.id) setReplaced(isComplete(choice) ? choice.workspaceName : null);
    setChoice((current) => next(current?.workspaceId === workspace.id ? current
      : { workspaceId: workspace.id, workspaceName: workspace.name, whole: true, pick: { folderIds: [], documentIds: [] }, names: {} }));
  };
  const chooseWorkspace = (row: WorkspaceRow) => {
    setExpanded(row.id);
    inWorkspace(row, (current) => current);
  };
  const toggleFile = (file: SourceFileMatch, checked: boolean) => {
    if (isSheet(file)) {
      inWorkspace({ id: file.workspaceId, name: file.workspaceName }, (current) => ({ ...current, spreadsheet: { id: file.id, name: file.name, mimeType: file.mimeType } }));
      return;
    }
    inWorkspace({ id: file.workspaceId, name: file.workspaceName }, (current) => {
      const documentIds = new Set(current.whole || mode === 'file' ? [] : current.pick.documentIds);
      if (checked) documentIds.add(file.id); else documentIds.delete(file.id);
      return {
        ...current, spreadsheet: undefined, whole: false,
        pick: { folderIds: current.whole || mode === 'file' ? [] : current.pick.folderIds, documentIds: [...documentIds] },
        names: { ...current.names, [file.id]: file.name }, mimeTypes: { ...current.mimeTypes, [file.id]: file.mimeType },
      };
    });
  };

  const summary = !isComplete(choice) ? t('assistantSources.chooser.nothingChosen')
    : choice.spreadsheet ? t('assistantSources.chooser.spreadsheetChosen', { name: choice.spreadsheet.name, workspace: choice.workspaceName })
    : choice.whole ? t('assistantSources.chooser.wholeChosen', { workspace: choice.workspaceName })
    : t('assistantSources.chooser.pickedChosen', { workspace: choice.workspaceName, items: [...choice.pick.folderIds, ...choice.pick.documentIds].map((id) => choice.names[id]).filter(Boolean).join(', ') || String(choice.pick.folderIds.length + choice.pick.documentIds.length) });

  const renderWorkspace = (row: WorkspaceRow) => {
    const isOpen = findsFiles && expanded === row.id;
    const chosen = choice?.workspaceId === row.id;
    return <li key={row.id} className={chosen ? 'bg-primary/10' : undefined}>
      <div className='flex items-center gap-1 py-1 pl-1 pr-2'>
        {findsFiles && <Button type='button' size='icon' variant='ghost' className='h-7 w-7 shrink-0' onClick={() => setExpanded(isOpen ? null : row.id)}
          aria-label={isOpen ? t('knowledge.collapseWorkspace', { name: row.name }) : t('knowledge.expandWorkspace', { name: row.name })}>
          {isOpen ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
        </Button>}
        <button type='button' className='flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60' onClick={() => chooseWorkspace(row)} aria-label={t('assistantSources.chooser.pickWorkspace', { name: row.name })} aria-pressed={chosen}>
          {row.shared ? <Share2 className='h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400' /> : <Warehouse className='h-4 w-4 shrink-0 text-primary' />}
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>{row.name}</span>
            <span className='block text-[11px] text-muted-foreground'>{t('assistantSources.chooser.fileCount', { count: row.documentCount })}{row.shared ? ` · ${t('assistantSources.chooser.shared')}` : ''}</span>
          </span>
        </button>
      </div>
      {isOpen && <div className='border-t bg-muted/20 p-2'>
        <WorkspaceFilePicker workspaceId={row.id} name={row.name}
          // Opening a workspace shows its files; it is chosen only once something in it is picked (or it is picked whole).
          whole={chosen ? choice!.whole && !choice!.spreadsheet : false}
          pick={chosen && !choice!.spreadsheet ? choice!.pick : { folderIds: [], documentIds: [] }}
          onChange={(next) => inWorkspace(row, (current) => ({ ...current, spreadsheet: undefined, whole: next.whole, pick: mode === 'file' ? onePick(current.pick, next.pick) : next.pick }))}
          onNamed={(id, name, mimeType) => setChoice((current) => current?.workspaceId === row.id
            ? { ...current, names: { ...current.names, [id]: name }, mimeTypes: mimeType ? { ...current.mimeTypes, [id]: mimeType } : current.mimeTypes }
            : current)}
          {...(mode === 'source'
            ? { onPickSpreadsheet: (file) => inWorkspace(row, (current) => ({ ...current, spreadsheet: { id: file.id, name: file.originalName, mimeType: file.mimeType } })) }
            : { canPick: () => true, folders: false })} />
      </div>}
    </li>;
  };

  const rows = workspaces.data?.rows ?? [];
  const own = rows.filter((row) => !row.shared);
  const shared = rows.filter((row) => row.shared);
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className='flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 p-4 sm:p-6' aria-describedby={undefined}>
      <DialogHeader>
        <div className='flex items-center gap-1'>
          <DialogTitle>{title ?? t('assistantSources.chooser.title', { concept: conceptLabel })}</DialogTitle>
          <HelpTip text={description ?? t('assistantSources.chooser.description')} />
        </div>
      </DialogHeader>
      <div className='relative'>
        <Search className='pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
        <Input autoFocus className={`${INPUT} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('assistantSources.chooser.search')} aria-label={t('assistantSources.chooser.search')} />
      </div>
      <div className='min-h-0 flex-1 space-y-6 overflow-y-auto pr-1' data-testid='source-chooser-list'>
        {findsFiles && term.length >= MIN_FILE_SEARCH && <section aria-label={t('assistantSources.chooser.files')} className='space-y-2'>
          <SectionHeader title={t('assistantSources.chooser.files')} count={files.data?.files.length || undefined} />
          {files.isLoading ? <div className='flex justify-center p-3'><Loader2 className='h-4 w-4 animate-spin text-primary' /></div>
            : !files.data?.files.length ? <p className='text-xs text-muted-foreground'>{t('assistantSources.chooser.noFiles')}</p>
            : <ul className={ROW_LIST}>{files.data.files.map((file) => {
              const spreadsheet = isSheet(file);
              const readable = mode === 'files' || mode === 'file' || spreadsheet || isReadableDocument(file.mimeType);
              const picked = choice?.workspaceId === file.workspaceId && (choice.spreadsheet ? choice.spreadsheet.id === file.id : !choice.whole && choice.pick.documentIds.includes(file.id));
              return <li key={file.id}>
                <label className={`flex min-h-10 items-center gap-2 px-3 py-1 text-sm ${readable ? 'cursor-pointer hover:bg-muted/60' : 'opacity-60'} ${picked ? 'bg-primary/10' : ''}`}>
                  <input type={spreadsheet || mode === 'file' ? 'radio' : 'checkbox'} name={spreadsheet ? 'source-chooser-sheet' : mode === 'file' ? 'source-chooser-file' : undefined} disabled={!readable} checked={picked} onChange={(event) => toggleFile(file, event.target.checked)} />
                  {spreadsheet ? <FileSpreadsheet className='h-4 w-4 shrink-0 text-emerald-600' /> : <FileText className='h-4 w-4 shrink-0 text-muted-foreground' />}
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{file.name}</span>
                    <span className='block truncate text-[11px] text-muted-foreground'>{file.folderName ? t('assistantSources.chooser.inFolder', { workspace: file.workspaceName, folder: file.folderName }) : file.workspaceName}</span>
                  </span>
                  {!readable && <span className='shrink-0 text-[10px] text-muted-foreground'>{t('knowledge.notReadable')}</span>}
                </label>
              </li>;
            })}</ul>}
        </section>}
        {findsFiles && term.length > 0 && term.length < MIN_FILE_SEARCH && <p className='text-xs text-muted-foreground'>{t('assistantSources.chooser.searchHint')}</p>}
        <section aria-label={t('assistantSources.chooser.workspaces')} className='space-y-2'>
          <SectionHeader title={t('assistantSources.chooser.workspaces')} />
          {workspaces.isError ? <p className='text-xs text-muted-foreground'>{t('assistantSources.chooser.loadError')}</p>
            : workspaces.isLoading ? <div className='flex justify-center p-3'><Loader2 className='h-4 w-4 animate-spin text-primary' /></div>
            : !rows.length ? <p className='text-xs text-muted-foreground'>{t('assistantSources.chooser.noWorkspaces')}</p>
            : <>
              {own.length > 0 && <ul className={`${ROW_LIST} overflow-hidden`}>{own.map(renderWorkspace)}</ul>}
              {workspaces.data?.more && <Button type='button' variant='ghost' size='sm' className='w-full text-xs' disabled={workspaces.isFetching} onClick={() => setWorkspacePages((pages) => pages + 1)}>{t('assistantSources.chooser.loadMore')}</Button>}
              {shared.length > 0 && <>
                <h4 className='flex items-center gap-1.5 pt-2 text-xs font-medium text-muted-foreground'><Share2 className='h-3 w-3' aria-hidden />{t('assistantSources.chooser.shared')}</h4>
                <ul className={`${ROW_LIST} overflow-hidden`}>{shared.map(renderWorkspace)}</ul>
              </>}
            </>}
        </section>
      </div>
      <div className='space-y-1 border-t pt-3'>
        <p className={`text-sm ${isComplete(choice) ? 'font-medium' : 'text-muted-foreground'}`} aria-live='polite'>{summary}</p>
        {replaced && <p className='text-xs text-amber-700 dark:text-amber-400'>{t('assistantSources.chooser.oneWorkspace', { workspace: replaced })}</p>}
      </div>
      <DialogFooter className='gap-2 sm:gap-0'>
        <Button type='button' variant='ghost' onClick={onClose}>{t('assistantSources.chooser.cancel')}</Button>
        <Button type='button' disabled={!isComplete(choice)} onClick={() => { if (isComplete(choice)) onChoose(mode === 'file' ? oneFile(choice) : choiceToOption(choice)); }}>{useLabel ?? t('assistantSources.chooser.use')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
