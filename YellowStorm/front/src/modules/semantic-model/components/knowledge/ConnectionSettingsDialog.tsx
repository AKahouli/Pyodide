import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { DataConnection } from '../../types';
import { ArchiveLimitsEditor } from './ArchiveLimitsEditor';

/** A connection's settings: whether its archive is also indexed in the workspace, and how much of it a run reads. */
export function ConnectionSettingsDialog({ modelId, connection, canEdit, onOpenChange }: Readonly<{
  modelId: string; connection: DataConnection | null; canEdit: boolean; onOpenChange: (open: boolean) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const indexing = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => semanticModelApi.updateDataConnection(modelId, id, { indexInWorkspace: on }),
    onSuccess: () => void client.invalidateQueries({ queryKey: semanticModelQueryKeys.dataConnections(modelId) }),
    onError: (error) => showError(t('dataSources.indexError'), { description: parseApiError(error).message }),
  });

  return <Dialog open={connection !== null} onOpenChange={onOpenChange}>
    <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
      {connection && <>
        <DialogHeader>
          <DialogTitle>{t('dataSources.settingsTitle', { name: connection.name })}</DialogTitle>
          <DialogDescription>{t(`dataSources.kind.${connection.kind}`)}</DialogDescription>
        </DialogHeader>
        <label className='flex items-start gap-2 text-sm'>
          <Checkbox className='mt-0.5' checked={connection.indexInWorkspace} disabled={!canEdit || indexing.isPending}
            aria-label={t('dataSources.indexToggle', { name: connection.name })}
            onCheckedChange={(value) => indexing.mutate({ id: connection.id, on: value === true })} />
          <span>{t('dataSources.indexInWorkspace')}<span className='block text-xs text-muted-foreground'>{t('dataSources.indexInWorkspaceHelp')}</span></span>
        </label>
        <section className='space-y-2 border-t pt-4'>
          <h3 className='text-sm font-medium'>{t('dataSources.limits.title')}</h3>
          <p className='text-xs text-muted-foreground'>{t('dataSources.limits.help')}</p>
          <ArchiveLimitsEditor modelId={modelId} connection={connection} canEdit={canEdit} />
        </section>
      </>}
    </DialogContent>
  </Dialog>;
}
