import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Database, FolderOpen, Globe, Loader2, Mail, Search, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { getDocuments, getWorkspaces } from '@/modules/workspace/api';
import type { Workspace, WorkspaceDocument } from '@/modules/workspace/types';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { isMailArchive } from '../../utils/data-sources';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../common/Select';
import { INPUT } from '../form/FormParts';

type Connector = { key: 'mail' | 'workspace' | 'postgres' | 'mssql' | 'rest'; icon: typeof Mail; ready: boolean };

// SQL databases and REST APIs are shown so people see where this goes; they come in a later step.
const CONNECTORS: Connector[] = [
  { key: 'mail', icon: Mail, ready: true },
  { key: 'workspace', icon: FolderOpen, ready: true },
  { key: 'postgres', icon: Database, ready: false },
  { key: 'mssql', icon: Server, ready: false },
  { key: 'rest', icon: Globe, ready: false },
];

/** The archives of a workspace: its .zip and .eml files, found by name and kept when their type says so. */
async function findArchives(workspaceId: string, search: string): Promise<WorkspaceDocument[]> {
  const terms = search.trim() ? [search.trim()] : ['.zip', '.eml'];
  const pages = await Promise.all(terms.map((term) => getDocuments(workspaceId, { limit: 50, page: 1, search: term })));
  const seen = new Set<string>();
  return pages.flatMap((page) => page.documents)
    .filter((document) => !document.isFolder && isMailArchive(document.mimeType) && !seen.has(document.id) && Boolean(seen.add(document.id)));
}

/**
 * Connects the model to a data source. A mail archive is a file of a workspace; workspaces themselves are
 * listed in the explorer already, so picking them only points there.
 */
export function ConnectDataSourceDialog({ modelId, open, onOpenChange, onShowWorkspaces }: Readonly<{
  modelId: string; open: boolean; onOpenChange: (open: boolean) => void; onShowWorkspaces: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const [step, setStep] = useState<'kind' | 'mail'>('kind');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const [archives, setArchives] = useState<WorkspaceDocument[] | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [name, setName] = useState('');
  const [indexInWorkspace, setIndexInWorkspace] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('kind'); setWorkspaceId(''); setSearch(''); setArchives(null); setDocumentId(''); setName(''); setIndexInWorkspace(false);
  }, [open]);
  useEffect(() => {
    if (step !== 'mail' || workspaces.length) return;
    getWorkspaces({ limit: 100, page: 1 }).then((result) => setWorkspaces(result.workspaces))
      .catch((error) => showError(t('knowledge.loadError'), { description: parseApiError(error).message }));
  }, [step, workspaces.length, t]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setArchives(null);
    const timer = window.setTimeout(() => void findArchives(workspaceId, search)
      .then((found) => { if (active) setArchives(found); })
      .catch(() => { if (active) setArchives([]); }), 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [workspaceId, search]);

  const connect = useMutation({
    mutationFn: () => semanticModelApi.createDataConnection(modelId, { kind: 'mail_archive', workspaceId, documentId, name: name.trim() || undefined, indexInWorkspace }),
    onSuccess: (connection) => {
      void client.invalidateQueries({ queryKey: semanticModelQueryKeys.dataConnections(modelId) });
      showSuccess(t('dataSources.connected', { name: connection.name }));
      onOpenChange(false);
    },
    onError: (error) => showError(t('dataSources.connectError'), { description: parseApiError(error).message }),
  });

  const pick = (connector: Connector) => {
    if (connector.key === 'workspace') { onOpenChange(false); onShowWorkspaces(); return; }
    if (connector.key === 'mail') setStep('mail');
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!connect.isPending) onOpenChange(next); }}>
    <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
      <DialogHeader>
        <DialogTitle>{step === 'mail' ? t('dataSources.dialog.mail.title') : t('dataSources.dialog.title')}</DialogTitle>
        <DialogDescription>{step === 'mail' ? t('dataSources.dialog.mail.description') : t('dataSources.dialog.description')}</DialogDescription>
      </DialogHeader>
      {step === 'kind' ? <div className='grid gap-2 sm:grid-cols-2'>
        {CONNECTORS.map((connector) => <button key={connector.key} type='button' disabled={!connector.ready} onClick={() => pick(connector)}
          className={cn('flex min-h-20 items-start gap-3 rounded-xl border p-3 text-start transition', connector.ready ? 'hover:border-teal-500 hover:bg-teal-500/5' : 'cursor-not-allowed opacity-60')}>
          <span className='rounded-lg bg-muted p-2'><connector.icon className='h-5 w-5 text-teal-600 dark:text-teal-400' /></span>
          <span className='min-w-0 flex-1'>
            <span className='flex items-center gap-2 text-sm font-medium'>{t(`dataSources.dialog.${connector.key}.title`)}
              {!connector.ready && <span className='rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border'>{t('dataSources.dialog.soon')}</span>}</span>
            <span className='mt-0.5 block text-xs text-muted-foreground'>{t(`dataSources.dialog.${connector.key}.description`)}</span>
          </span>
        </button>)}
      </div> : <div className='space-y-4'>
        <label className='block space-y-1.5 text-sm'>
          <span className='font-medium'>{t('dataSources.dialog.workspaceLabel')}</span>
          <Select value={workspaceId} onValueChange={(value) => { setWorkspaceId(value); setDocumentId(''); }}>
            <SelectTrigger aria-label={t('dataSources.dialog.workspaceLabel')}><SelectValue placeholder={t('dataSources.dialog.workspacePlaceholder')} /></SelectTrigger>
            <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {workspaceId && <div className='space-y-1.5 text-sm'>
          <span className='font-medium'>{t('dataSources.dialog.fileLabel')}</span>
          <div className='relative'><Search className='pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input className={`${INPUT} ps-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('dataSources.dialog.searchFiles')} aria-label={t('dataSources.dialog.searchFiles')} /></div>
          <div role='radiogroup' aria-label={t('dataSources.dialog.fileLabel')} className='max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1.5'>
            {archives === null ? <div className='flex justify-center p-3'><Loader2 className='h-4 w-4 animate-spin text-primary' /></div>
              : archives.length ? archives.map((archive) => <label key={archive.id} className={cn('flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs', documentId === archive.id ? 'bg-teal-500/10' : 'hover:bg-muted/60')}>
                <input type='radio' name='mail-archive' checked={documentId === archive.id} onChange={() => setDocumentId(archive.id)} />
                <Mail className='h-3.5 w-3.5 shrink-0 text-muted-foreground' /><span className='min-w-0 flex-1 truncate'>{archive.originalName}</span>
              </label>)
              : <p className='p-3 text-center text-xs text-muted-foreground'>{t('dataSources.dialog.noArchive')}</p>}
          </div>
        </div>}
        {documentId && <label className='block space-y-1.5 text-sm'>
          <span className='font-medium'>{t('dataSources.dialog.nameLabel')}</span>
          <Input className={INPUT} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t('dataSources.dialog.namePlaceholder')} />
        </label>}
        {documentId && <label className='flex items-start gap-2 text-sm'>
          <Checkbox className='mt-0.5' checked={indexInWorkspace} onCheckedChange={(value) => setIndexInWorkspace(value === true)} aria-label={t('dataSources.dialog.indexLabel')} />
          <span><span className='font-medium'>{t('dataSources.dialog.indexLabel')}</span>
            <span className='mt-0.5 block text-xs text-muted-foreground'>{t('dataSources.indexInWorkspaceHelp')}</span></span>
        </label>}
      </div>}
      {step === 'mail' && <DialogFooter className='gap-2 sm:justify-between'>
        <Button variant='ghost' onClick={() => setStep('kind')} disabled={connect.isPending}><ArrowLeft className='me-1.5 h-4 w-4' />{t('dataSources.dialog.back')}</Button>
        <Button onClick={() => connect.mutate()} disabled={!documentId || connect.isPending}>{connect.isPending && <Loader2 className='me-2 h-4 w-4 animate-spin' />}{t('dataSources.dialog.submit')}</Button>
      </DialogFooter>}
    </DialogContent>
  </Dialog>;
}
