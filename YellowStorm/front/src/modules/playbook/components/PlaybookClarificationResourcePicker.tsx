import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useModuleTranslation } from '@/modules/localization';
import * as workspaceApi from '@/modules/workspace/api';
import type { Workspace, WorkspaceDocument } from '@/modules/workspace/types';
import type { PlaybookIntentClarificationQuestion, PlaybookIntentClarificationResource } from '../types';

interface Props {
  open: boolean;
  mode: NonNullable<PlaybookIntentClarificationQuestion['resourceSelector']> | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (resource: PlaybookIntentClarificationResource) => void;
}

function getDocumentName(document: WorkspaceDocument): string {
  return document.isFolder ? document.folderName || document.originalName || document.filename : document.originalName || document.filename;
}

export function PlaybookClarificationResourcePicker({ open, mode, onOpenChange, onSelect }: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const documentsRequestRef = useRef(0);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const canSelectDocuments = mode === 'workspace_or_document';

  useEffect(() => {
    if (!open) return;
    setLoadError('');
    setLoadingWorkspaces(true);
    workspaceApi.getWorkspaces({ limit: 100 })
      .then((result) => {
        setWorkspaces(result.workspaces);
        setWorkspaceId((current) => current && result.workspaces.some((workspace) => workspace.id === current) ? current : result.workspaces[0]?.id ?? '');
      })
      .catch(() => {
        setWorkspaces([]);
        setWorkspaceId('');
        setLoadError(t('intentBar.design.resource.loadError'));
      })
      .finally(() => setLoadingWorkspaces(false));
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    if (!workspaceId || !canSelectDocuments) {
      documentsRequestRef.current += 1;
      setDocuments([]);
      return;
    }
    setLoadingDocuments(true);
    setLoadError('');
    const requestId = documentsRequestRef.current + 1;
    documentsRequestRef.current = requestId;
    workspaceApi.getHierarchicalDocuments(workspaceId, { limit: 100 })
      .then((result) => {
        if (documentsRequestRef.current === requestId) {
          setDocuments(result.documents);
        }
      })
      .catch(() => {
        if (documentsRequestRef.current === requestId) {
          setDocuments([]);
          setLoadError(t('intentBar.design.resource.loadError'));
        }
      })
      .finally(() => {
        if (documentsRequestRef.current === requestId) {
          setLoadingDocuments(false);
        }
      });
  }, [canSelectDocuments, open, t, workspaceId]);

  const filteredDocuments = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return documents;
    return documents.filter((document) => getDocumentName(document).toLowerCase().includes(normalized));
  }, [documents, search]);

  const selectWorkspace = useCallback(() => {
    if (!activeWorkspace) return;
    onSelect({ kind: 'workspace', id: activeWorkspace.id, name: activeWorkspace.name, workspaceId: activeWorkspace.id, workspaceName: activeWorkspace.name });
    onOpenChange(false);
  }, [activeWorkspace, onOpenChange, onSelect]);

  const selectDocument = useCallback((document: WorkspaceDocument) => {
    if (!activeWorkspace || document.isFolder) return;
    onSelect({
      kind: 'document',
      id: document.id,
      name: getDocumentName(document),
      workspaceId: activeWorkspace.id,
      workspaceName: activeWorkspace.name,
      path: document.path,
      mimeType: document.mimeType,
    });
    onOpenChange(false);
  }, [activeWorkspace, onOpenChange, onSelect]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'destination_workspace' ? t('intentBar.design.resource.destinationTitle') : t('intentBar.design.resource.sourceTitle')}</DialogTitle>
          <DialogDescription>{t('intentBar.design.resource.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <select aria-label={t('intentBar.design.resource.workspaceLabel')} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {loadingWorkspaces ? <option value="">{t('intentBar.design.resource.loadingWorkspaces')}</option> : null}
            {!loadingWorkspaces && workspaces.length === 0 ? <option value="">{t('intentBar.design.resource.noWorkspaces')}</option> : null}
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          <Button type="button" variant="outline" className="w-full justify-start" onClick={selectWorkspace} disabled={!activeWorkspace}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {mode === 'destination_workspace' ? t('intentBar.design.resource.useDestinationWorkspace') : t('intentBar.design.resource.useSourceWorkspace', { name: activeWorkspace?.name ?? '' })}
          </Button>
          {canSelectDocuments ? (
            <div className="space-y-2">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('intentBar.design.resource.searchDocuments')} />
              <ScrollArea className="h-72 rounded-md border">
                {loadingDocuments ? (
                  <div className="flex h-24 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('intentBar.design.resource.loadingDocuments')}</div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">{t('intentBar.design.resource.noDocuments')}</div>
                ) : filteredDocuments.map((document) => (
                  <button key={document.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60" onClick={() => selectDocument(document)} disabled={document.isFolder}>
                    {document.isFolder ? <FolderOpen className="h-4 w-4 text-blue-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{getDocumentName(document)}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('intentBar.design.resource.cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
