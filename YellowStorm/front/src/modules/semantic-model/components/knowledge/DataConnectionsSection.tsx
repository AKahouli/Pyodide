import { useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical, Loader2, Mail, Plug, Plus, RefreshCw, Settings, Table2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { KnowledgeResource } from '../../hooks/use-knowledge-linking';
import { useDataConnections } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { DataConnection } from '../../types';
import { MAIL_TABLES, tableLabel } from '../../utils/data-sources';
import { SectionHeader } from '../form/FormParts';
import { ConnectionSettingsDialog } from './ConnectionSettingsDialog';
import { ConnectDataSourceDialog } from './ConnectDataSourceDialog';

type TableResource = Extract<KnowledgeResource, { kind: 'document' }>;

/** Makes a mail archive file of a workspace a connection of the model, listed with its tables. */
export function ConnectArchiveButton({ modelId, workspaceId, documentId, name }: Readonly<{ modelId: string; workspaceId: string; documentId: string; name: string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const connect = useMutation({
    mutationFn: () => semanticModelApi.createDataConnection(modelId, { kind: 'mail_archive', workspaceId, documentId }),
    onSuccess: (connection) => {
      void client.invalidateQueries({ queryKey: semanticModelQueryKeys.dataConnections(modelId) });
      showSuccess(t('dataSources.connected', { name: connection.name }));
    },
    onError: (error) => showError(t('dataSources.connectError'), { description: parseApiError(error).message }),
  });
  return <Button size='sm' variant='ghost' className='h-11 min-w-11 shrink-0 px-2 text-teal-700 dark:text-teal-400' disabled={connect.isPending} onClick={() => connect.mutate()}
    aria-label={t('dataSources.connectAsMailOf', { name })} title={t('dataSources.connectAsMail')}>
    {connect.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Plug className='h-3.5 w-3.5' />}</Button>;
}

/** A mail archive's tables, in a fixed order, with their size once the archive has been read. */
function ConnectionTables({ modelId, connection, canEdit, onUse, onDragStart, onDragEnd }: Readonly<{
  modelId: string; connection: DataConnection; canEdit: boolean;
  onUse?: (resource: TableResource) => void; onDragStart: (event: DragEvent, resource: TableResource) => void; onDragEnd: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  // Shared with the mapping drawer, so a table opened from here is already read there.
  const profileKey = semanticModelQueryKeys.sourceAssetProfile(modelId, connection.documentId);
  const profile = useQuery({ queryKey: profileKey, queryFn: () => semanticModelApi.profileSourceAsset(modelId, connection.documentId, connection.workspaceId), retry: false });
  const read = useMutation({
    mutationFn: () => semanticModelApi.analyzeSourceAsset(modelId, connection.documentId, connection.workspaceId),
    onSuccess: (data) => client.setQueryData(profileKey, data),
    onError: (error) => showError(t('dataSources.readError'), { description: parseApiError(error).message }),
  });
  if (profile.isLoading) return <div className='flex justify-center p-3'><Loader2 className='h-4 w-4 animate-spin text-primary' /></div>;
  const sheets = profile.data?.sheets ?? [];
  const sizes = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const names = [...MAIL_TABLES, ...sheets.map((sheet) => sheet.name).filter((name) => !(MAIL_TABLES as readonly string[]).includes(name))];
  return <div className='space-y-1'>
    {!sheets.length && <div className='flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground'>
      <span className='flex-1'>{t('dataSources.notRead')}</span>
      {canEdit && <Button size='sm' variant='outline' className='h-8 gap-1 text-xs' disabled={read.isPending} onClick={() => read.mutate()}>
        {read.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <RefreshCw className='h-3.5 w-3.5' />}{t('dataSources.readNow')}</Button>}
    </div>}
    {names.map((name) => {
      const label = tableLabel(t, name);
      const size = sizes.get(name);
      const resource: TableResource = {
        kind: 'document', workspaceId: connection.workspaceId, documentId: connection.documentId, name: `${connection.name} · ${label}`,
        structured: true, mappable: true, mimeType: 'application/zip', sheetName: name,
      };
      return <div key={name} role='group' aria-label={t('dataSources.dragTable', { name: label })} draggable={canEdit} onDragStart={(event) => onDragStart(event, resource)} onDragEnd={onDragEnd}
        className='flex min-h-11 items-center gap-2 rounded-lg ps-6 pe-1 hover:bg-background'>
        <Table2 className='h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400' />
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-xs font-medium'>{label}</span>
          {size && <span className='block text-[10px] text-muted-foreground'>{t(size.rowCount === 1 ? 'dataSources.rows_one' : 'dataSources.rows_other', { count: size.rowCount })} · {t('dataSources.fields', { count: size.fieldCount })}</span>}
        </span>
        {canEdit && onUse && <><GripVertical className='h-3.5 w-3.5 text-muted-foreground' />
          <Button size='sm' variant='ghost' className='h-11 min-w-11 shrink-0 gap-1 px-2 text-xs text-teal-700 dark:text-teal-400' onClick={() => onUse(resource)} aria-label={t('dataSources.useTable', { name: label })}>{t('knowledge.use')}</Button></>}
      </div>;
    })}
  </div>;
}

/**
 * The data sources the model is connected to, each opening on its tables. A table is dragged onto a
 * concept (or used with its button) like a file; for now the connections are mail archives.
 */
export function DataConnectionsSection({ modelId, canEdit, onUse, onDragStart, onDragEnd, onShowWorkspaces }: Readonly<{
  modelId: string; canEdit: boolean;
  onUse?: (resource: TableResource) => void; onDragStart: (event: DragEvent, resource: TableResource) => void; onDragEnd: () => void;
  onShowWorkspaces: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const connections = useDataConnections(modelId || undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (connection: DataConnection) => semanticModelApi.deleteDataConnection(modelId, connection.id),
    onSuccess: () => { void client.invalidateQueries({ queryKey: semanticModelQueryKeys.dataConnections(modelId) }); showSuccess(t('dataSources.removed')); },
    onError: (error) => showError(t('dataSources.removeError'), { description: parseApiError(error).message }),
  });
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const items = connections.data ?? [];

  return <section className='mb-6 space-y-2' aria-label={t('dataSources.connections')}>
    <SectionHeader title={t('dataSources.connections')} help={t('dataSources.connectionsHelp')} count={items.length || undefined}>
      {canEdit && modelId && <Button size='sm' variant='outline' className='ms-auto h-8 gap-1 text-xs' onClick={() => setConnectOpen(true)} title={t('dataSources.connectHint')}><Plus className='h-3.5 w-3.5' />{t('dataSources.connect')}</Button>}
    </SectionHeader>
    {connections.isLoading ? <div className='flex justify-center p-3'><Loader2 className='h-4 w-4 animate-spin text-primary' /></div>
      : items.length ? items.map((connection) => {
        const open = expanded.has(connection.id) && connection.available;
        return <div key={connection.id} className='overflow-hidden rounded-xl border bg-card'>
          <div role='group' aria-label={connection.name} className='flex items-center gap-1 p-2'>
            <Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' disabled={!connection.available} onClick={() => toggle(connection.id)}
              aria-label={open ? t('dataSources.collapse', { name: connection.name }) : t('dataSources.expand', { name: connection.name })}>{open ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}</Button>
            <Mail className='h-4 w-4 shrink-0 text-primary' />
            <div className='min-w-0 flex-1 px-1'>
              <p className='truncate text-sm font-medium'>{connection.name}</p>
              {connection.available ? <p className='text-[10px] text-muted-foreground'>{t(`dataSources.kind.${connection.kind}`)}</p>
                : <p className='flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3 w-3' />{t('dataSources.unavailable')}</p>}
            </div>
            <Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' onClick={() => setSettingsOf(connection.id)} aria-label={t('dataSources.settingsOpen', { name: connection.name })} title={t('dataSources.settingsOpen', { name: connection.name })}><Settings className='h-4 w-4' /></Button>
            {canEdit && <Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' disabled={remove.isPending} onClick={() => remove.mutate(connection)} aria-label={t('dataSources.remove', { name: connection.name })}><Trash2 className='h-4 w-4' /></Button>}
          </div>
          {open && <div className='border-t bg-muted/20 p-2'><ConnectionTables modelId={modelId} connection={connection} canEdit={canEdit} onUse={onUse} onDragStart={onDragStart} onDragEnd={onDragEnd} /></div>}
        </div>;
      })
      : <p className='rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground'>{t('dataSources.empty')}</p>}
    <ConnectionSettingsDialog modelId={modelId} connection={items.find((item) => item.id === settingsOf) ?? null} canEdit={canEdit} onOpenChange={(next) => { if (!next) setSettingsOf(null); }} />
    {modelId && <ConnectDataSourceDialog modelId={modelId} open={connectOpen} onOpenChange={setConnectOpen} onShowWorkspaces={onShowWorkspaces} />}
  </section>;
}
