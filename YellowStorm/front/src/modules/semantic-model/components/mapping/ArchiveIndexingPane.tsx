import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useDataConnections } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { ArchiveLimitsEditor, useArchiveLimitsSummary } from '../knowledge/ArchiveLimitsEditor';
import { SettingsPane } from '../settings/SettingsPane';

/**
 * The settings of a mail archive's data source: whether a run also copies its e-mails and attachments
 * into its workspace, and how much of it a run reads. They belong to the data source, so they are saved
 * at once, not with the mapping; an archive not connected yet is connected when indexing is turned on.
 */
export function ArchiveIndexingPane({ modelId, workspaceId, documentId, canEdit, open, onOpenChange }: Readonly<{
  modelId: string; workspaceId: string; documentId: string; canEdit: boolean;
  open: boolean; onOpenChange: (open: boolean) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const limitsSummary = useArchiveLimitsSummary();
  const client = useQueryClient();
  const connections = useDataConnections(modelId);
  const connection = connections.data?.find((item) => item.kind === 'mail_archive' && item.documentId === documentId);
  const on = connection?.indexInWorkspace === true;
  const change = useMutation({
    mutationFn: (next: boolean) => connection
      ? semanticModelApi.updateDataConnection(modelId, connection.id, { indexInWorkspace: next })
      : semanticModelApi.createDataConnection(modelId, { kind: 'mail_archive', workspaceId, documentId, indexInWorkspace: next }),
    onSuccess: () => client.invalidateQueries({ queryKey: semanticModelQueryKeys.dataConnections(modelId) }),
    onError: (error) => showError(t('dataSources.indexError'), { description: parseApiError(error).message }),
  });
  return <SettingsPane id='sheet-archive' open={open} onOpenChange={onOpenChange} title={t('mapping.pane.archiveTitle')}
    help={t('dataSources.indexInWorkspaceHelp')} icon={<Mail className='h-4 w-4 shrink-0 text-muted-foreground' />}
    summary={[on ? t('mapping.pane.archiveOn') : t('mapping.pane.archiveOff'), connection && limitsSummary(connection)].filter(Boolean).join(' · ')}>
    <label className='flex items-start gap-2 text-sm'>
      <Checkbox className='mt-0.5' checked={on} disabled={!canEdit || connections.isLoading || change.isPending}
        onCheckedChange={(value) => change.mutate(value === true)} aria-label={t('dataSources.dialog.indexLabel')} />
      <span><span className='font-medium'>{t('dataSources.dialog.indexLabel')}</span>
        <span className='mt-0.5 block text-xs text-muted-foreground'>{t('mapping.pane.archiveSavedAtOnce')}</span></span>
    </label>
    <div className='space-y-2 border-t pt-3'>
      <p className='text-sm font-medium'>{t('dataSources.limits.title')}</p>
      {connection ? <ArchiveLimitsEditor modelId={modelId} connection={connection} canEdit={canEdit} />
        : <p className='text-xs text-muted-foreground'>{t('dataSources.limits.notConnected')}</p>}
    </div>
  </SettingsPane>;
}
