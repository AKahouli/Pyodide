import { useEffect, useState } from 'react';
import { Copy, Loader2, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useApiAction } from '@/lib/use-api-action';
import { showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { SemanticModel, SemanticModelCloneInclude } from '../../types';
import { FormField, HelpTip, INPUT } from '../form/FormParts';

type Option = keyof SemanticModelCloneInclude;
const OPTIONS: Option[] = ['sources', 'data', 'shares'];

/** Ticking the data brings the sources along and locks them: data without its sources could not be rebuilt. */
export function nextCloneInclude(current: SemanticModelCloneInclude, option: Option, checked: boolean): SemanticModelCloneInclude {
  const next = { ...current, [option]: checked };
  if (option === 'data' && checked) next.sources = true;
  if (option === 'sources' && !checked && current.data) next.sources = true;
  return next;
}

/**
 * Copies a model into a new one the user owns. The structure (concepts, fields, relationships,
 * identity rules, layout) always comes along; sources, built data and shares are ticked.
 */
export function CloneSemanticModelDialog({ model, open, onOpenChange }: Readonly<{
  model: Pick<SemanticModel, 'id' | 'name' | 'role'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOwner = model.role === 'owner' || !model.role;
  const [name, setName] = useState('');
  const [include, setInclude] = useState<SemanticModelCloneInclude>({ sources: true, data: false, shares: false });
  const suffix = t('clone.copySuffix');
  // Reset each time the dialog opens (the translated suffix is read then, not tracked).
  useEffect(() => {
    if (!open) return;
    setName(`${model.name} (${suffix})`);
    setInclude({ sources: true, data: false, shares: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model.name]);
  const preview = useQuery({
    queryKey: [...semanticModelQueryKeys.all, 'clone-preview', model.id],
    queryFn: () => semanticModelApi.clonePreview(model.id),
    enabled: open,
    staleTime: 30_000,
  });
  const action = useApiAction((payload: { name: string; include: SemanticModelCloneInclude }) =>
    semanticModelApi.clone(model.id, payload.name, payload.include), {
    showSuccessToast: true,
    successMessage: t('clone.created'),
    onSuccess: (copy) => {
      if (copy.dataCopy?.status === 'failed') showWarning(t('clone.dataNotCopied'));
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
      navigate(`/semantic-models/${copy.id}`);
    },
  });
  const counts = preview.data;
  const countOf = (option: Option): number | null | undefined =>
    option === 'sources' ? counts?.sources : option === 'data' ? counts?.records : counts?.people;
  const disabled = (option: Option) => action.isLoading
    || (option === 'sources' && include.data)
    || (option === 'shares' && !isOwner);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!action.isLoading) onOpenChange(next); }}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('clone.title')}</DialogTitle>
          <DialogDescription>{t('clone.description')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-4 text-sm'>
          <FormField label={t('clone.name')} htmlFor='clone-model-name'>
            <Input id='clone-model-name' className={INPUT} value={name} maxLength={160} autoFocus
              placeholder={t('clone.placeholder')} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <div className='space-y-2'>
            <p className='text-xs font-medium text-muted-foreground'>{t('clone.whatToCopy')}</p>
            <div className='flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2'>
              <Lock className='mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
              <span className='flex-1'>{t('clone.options.structure')}</span>
              <HelpTip text={t('clone.help.structure')} />
            </div>
            {OPTIONS.map((option) => {
              const count = countOf(option);
              return (
                <label key={option} className='flex items-start gap-2 px-2.5'
                  title={option === 'shares' && !isOwner ? t('clone.ownerOnlyShares') : undefined}>
                  <Checkbox className='mt-0.5' checked={include[option]} disabled={disabled(option)}
                    aria-label={t(`clone.options.${option}`)}
                    onCheckedChange={(checked) => setInclude((current) => nextCloneInclude(current, option, checked === true))} />
                  <span className='flex-1'>
                    {t(`clone.options.${option}`)}
                    {typeof count === 'number' && <span className='ml-1.5 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground'>{count}</span>}
                    {option === 'sources' && include.data && <span className='block text-xs text-muted-foreground'>{t('clone.sourcesNeeded')}</span>}
                  </span>
                  <HelpTip text={t(`clone.help.${option}`)} />
                </label>
              );
            })}
          </div>
          <p className='text-xs text-muted-foreground'>{t('clone.filesStay')}</p>
        </div>
        <DialogFooter>
          <Button variant='outline' disabled={action.isLoading} onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
          <Button disabled={!name.trim() || action.isLoading} onClick={() => void action.execute({ name: name.trim(), include })}>
            {action.isLoading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Copy className='mr-2 h-4 w-4' />}
            {action.isLoading ? t('clone.creating') : t('clone.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
