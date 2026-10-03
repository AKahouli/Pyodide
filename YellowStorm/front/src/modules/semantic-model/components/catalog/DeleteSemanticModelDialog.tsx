import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { SemanticModel } from '../../types';
import { DELETE_BUTTON } from '../form/FormParts';

/**
 * Deletes a model for good, with everything it holds. The owner ticks every acknowledgement to confirm;
 * workspace documents are not touched.
 */
export function DeleteSemanticModelDialog({ model, open, onOpenChange, onDeleted }: Readonly<{
  model: Pick<SemanticModel, 'id' | 'name' | 'nodeCount' | 'relationCount' | 'recordCount' | 'workspaceCount'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  const [acknowledged, setAcknowledged] = useState({ data: false, irreversible: false });
  useEffect(() => { if (open) setAcknowledged({ data: false, irreversible: false }); }, [open]);
  const action = useApiAction(() => semanticModelApi.deletePermanently(model.id), {
    showSuccessToast: true,
    successMessage: t('deleteModel.deleted', { name: model.name }),
    onSuccess: () => {
      onOpenChange(false);
      onDeleted?.();
      // Nothing of the model is left to read: drop its cached queries rather than refetch them.
      queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(model.id) });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
    },
  });
  const matches = acknowledged.data && acknowledged.irreversible;
  const items: string[] = [
    t('deleteModel.items.structure', { concepts: model.nodeCount ?? 0, relations: model.relationCount ?? 0 }),
    t('deleteModel.items.records', { count: model.recordCount ?? 0 }),
    t('deleteModel.items.sources', { count: model.workspaceCount ?? 0 }),
    t('deleteModel.items.review'),
    t('deleteModel.items.index'),
    t('deleteModel.items.history'),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!action.isLoading) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-destructive'><AlertTriangle className='h-5 w-5' />{t('deleteModel.title')}</DialogTitle>
          <DialogDescription>{t('deleteModel.description', { name: model.name })}</DialogDescription>
        </DialogHeader>
        <div className='space-y-3 text-sm'>
          <div className='rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
            <p className='font-medium text-destructive'>{t('deleteModel.willDelete')}</p>
            <ul className='mt-2 list-disc space-y-1 pl-5 text-muted-foreground'>{items.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <p className='text-muted-foreground'>{t('deleteModel.filesStay')}</p>
          {(['data', 'irreversible'] as const).map((key) => (
            <label key={key} className='flex items-start gap-2'>
              <Checkbox className='mt-0.5' checked={acknowledged[key]} aria-label={t(`deleteModel.acknowledge.${key}`)}
                onCheckedChange={(checked) => setAcknowledged((current) => ({ ...current, [key]: checked === true }))} />
              <span>{t(`deleteModel.acknowledge.${key}`)}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant='outline' disabled={action.isLoading} onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
          <Button variant='outline' className={DELETE_BUTTON} disabled={!matches || action.isLoading} onClick={() => void action.execute()}>
            {action.isLoading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Trash2 className='mr-2 h-4 w-4' />}
            {action.isLoading ? t('deleteModel.deleting') : t('deleteModel.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
