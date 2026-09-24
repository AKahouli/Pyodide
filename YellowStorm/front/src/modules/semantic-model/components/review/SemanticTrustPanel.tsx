import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useSemanticReadiness, useSemanticReviewItems } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticReviewItem, ValidationIssue } from '../../types';

export function SemanticTrustPanel({ modelId, canEdit, validation = [], canRunCheck = false, checking = false, onRunCheck, onClose }: Readonly<{
  modelId: string;
  canEdit: boolean;
  /** Findings of the last structural check, shown here instead of a floating card. */
  validation?: ValidationIssue[];
  canRunCheck?: boolean;
  checking?: boolean;
  onRunCheck?: () => void;
  onClose: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const focus = useSemanticModelEditorStore((state) => state.focus);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const restoreFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const readiness = useSemanticReadiness(modelId);
  const reviews = useSemanticReviewItems(modelId, status);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!isMobile) return;
    return () => { window.requestAnimationFrame(() => restoreFocusRef.current?.isConnected && restoreFocusRef.current.focus()); };
  }, [isMobile]);
  const resolve = useMutation({
    mutationFn: ({ item, decision }: { item: SemanticReviewItem; decision: 'accepted' | 'dismissed' | 'leave_unresolved' }) => {
      const selected = selections[item.id];
      return semanticModelApi.resolveReviewItem(modelId, item.id, {
        decision,
        selectedTargetId: item.kind === 'ambiguous_relation' ? selected : undefined,
        selectedMappingId: item.kind === 'source_conflict' ? selected : undefined,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'review-items', modelId] }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('trust.reviewResolved'));
    },
    onError: (error) => showError(t('trust.reviewError'), { description: error instanceof Error ? error.message : undefined }),
  });

  const content = (closeControl?: ReactNode) => <>
    <div className='relative flex items-center justify-between border-b p-4 pr-20 sm:pr-4'><div><h2 className='flex items-center gap-2 font-semibold'><ShieldCheck className='h-4 w-4 text-primary' />{t('trust.title')}</h2><p className='text-xs text-muted-foreground'>{t('trust.description')}</p></div>{closeControl}</div>
    <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-4'>
      <section>{readiness.isLoading ? <div className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-5 w-5 animate-spin' />{t('readinessState.loading')}</div> : readiness.isError ? <p className='rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>{t('readinessState.unavailable')}</p> : readiness.data?.status === 'not_configured' ? <div className='rounded-xl border border-dashed p-4'><p className='font-semibold'>{t('readinessState.notConfigured')}</p><p className='mt-1 text-sm text-muted-foreground'>{t('readinessState.notConfiguredAction')}</p></div> : readiness.data && <><div className='flex items-end justify-between'><div><p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>{t('trust.readiness')}</p><p className='mt-1 text-3xl font-semibold'>{readiness.data.score}%</p></div><p className='text-xs text-muted-foreground'>{t('trust.areaCount', { complete: readiness.data.completeAreas, total: readiness.data.totalAreas })}</p></div><div className='mt-3 h-2 overflow-hidden rounded-full bg-muted'><div className='h-full rounded-full bg-primary transition-[width]' style={{ width: `${readiness.data.score}%` }} /></div><div className='mt-3 space-y-2'>{readiness.data.areas.map((area) => <div key={area.key} className='flex gap-2 rounded-lg border p-2.5'>{area.complete ? <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-emerald-600' /> : <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' />}<div><p className='text-sm font-medium'>{t(`trust.area.${area.key}`)}</p>{!area.complete && <p className='text-xs text-muted-foreground'>{t(`trust.issue.${area.key}`)}</p>}</div></div>)}</div></>}</section>
      <section>
        <div className='flex items-center justify-between gap-2'>
          <h3 className='font-semibold'>{t('validation.title')}</h3>
          {onRunCheck && <Button size='sm' variant='outline' className='h-8' disabled={!canRunCheck || checking} onClick={onRunCheck}>
            {checking ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <CheckCircle2 className='mr-1.5 h-3.5 w-3.5' />}
            {t('action.validate')}
          </Button>}
        </div>
        {validation.length === 0
          ? <p className='mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('validation.cleanHint')}</p>
          : <div className='mt-3 space-y-2'>{validation.map((issue, index) => <button
              key={`${issue.code}-${issue.targetId}-${index}`}
              type='button'
              className='flex w-full gap-2 rounded-xl border p-3 text-left hover:bg-muted'
              onClick={() => issue.targetId && focus(issue.targetId)}
            >
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-destructive' : 'text-amber-600'}`} />
              <span className='min-w-0 text-xs'>
                {issue.targetId && <strong className='block truncate text-sm font-semibold'>{graph?.nodes.find((node) => node.id === issue.targetId)?.label ?? graph?.relations.find((relation) => relation.id === issue.targetId)?.label ?? graph?.records.find((record) => record.id === issue.targetId)?.label}</strong>}
                {t(`validation.issue.${issue.code}`)}
              </span>
            </button>)}</div>}
      </section>
      <section><div className='flex items-center justify-between'><h3 className='font-semibold'>{t('trust.reviewQueue')}</h3><div className='flex rounded-lg bg-muted p-0.5'><Button size='sm' variant={status === 'open' ? 'secondary' : 'ghost'} className='h-7 px-2' onClick={() => setStatus('open')}>{t('trust.open')}</Button><Button size='sm' variant={status === 'resolved' ? 'secondary' : 'ghost'} className='h-7 px-2' onClick={() => setStatus('resolved')}>{t('trust.resolved')}</Button></div></div>
        {reviews.isLoading && <Loader2 className='mx-auto mt-6 h-5 w-5 animate-spin text-muted-foreground' />}
        {!reviews.isLoading && !reviews.data?.length && <p className='mt-3 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground'>{t(`trust.${status}Empty`)}</p>}
        <div className='mt-3 space-y-3'>{reviews.data?.map((item) => <ReviewCard key={item.id} item={item} canEdit={canEdit} selection={selections[item.id]} onSelect={(value) => setSelections((current) => ({ ...current, [item.id]: value }))} onResolve={(decision) => resolve.mutate({ item, decision })} pending={resolve.isPending && resolve.variables?.item.id === item.id} />)}</div>
      </section>
    </div>
  </>;

  if (isMobile) return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent side='right' closeLabel={t('action.close')} className='inset-0 w-full max-w-none gap-0 p-0 [&>button]:right-0 [&>button]:top-0 [&>button]:flex [&>button]:h-16 [&>button]:w-20 [&>button]:items-center [&>button]:justify-center'>
      <SheetTitle className='sr-only'>{t('trust.title')}</SheetTitle>
      <SheetDescription className='sr-only'>{t('trust.description')}</SheetDescription>
      {content()}
    </SheetContent>
  </Sheet>;

  return <aside className='relative z-20 flex w-96 shrink-0 flex-col border-l bg-background shadow-xl'>
    {content(<Button size='icon' variant='ghost' onClick={onClose} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>)}
  </aside>;
}

function ReviewCard({ item, canEdit, selection, onSelect, onResolve, pending }: Readonly<{ item: SemanticReviewItem; canEdit: boolean; selection?: string; onSelect: (value: string) => void; onResolve: (decision: 'accepted' | 'dismissed' | 'leave_unresolved') => void; pending: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const options = reviewOptions(item);
  const label = String(item.details.entityLabel ?? item.details.sourceLabel ?? item.details.conceptLabel ?? item.details.documentName ?? item.targetId);
  const decision = item.resolution?.decision;
  const decisionKey = decision === 'accepted' ? 'trust.decision.accepted' : decision === 'leave_unresolved' ? 'trust.decision.leave_unresolved' : 'trust.decision.dismissed';
  return <article className='rounded-xl border p-3'><div className='flex items-start gap-2'><AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' /><div className='min-w-0'><p className='text-sm font-medium'>{t(`trust.kind.${item.kind}`)}</p><p className='truncate text-xs text-muted-foreground'>{label}</p></div></div>
    {item.kind === 'broken_mapping' && Array.isArray(item.details.missingFields) && <p className='mt-2 text-xs text-muted-foreground'>{t('mappingHealth.missing', { fields: item.details.missingFields.join(', ') })}</p>}
    {item.status === 'resolved' && <p className='mt-3 rounded-lg bg-muted p-2 text-xs'>{t(decisionKey)}</p>}
    {item.status === 'open' && canEdit && <><div className='mt-3'>{options.length > 0 && <Select value={selection} onValueChange={onSelect}><SelectTrigger className='h-9'><SelectValue placeholder={t('trust.chooseResolution')} /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>}</div><div className='mt-3 flex flex-wrap gap-2'>{options.length > 0 && <Button size='sm' disabled={!selection || pending} onClick={() => onResolve('accepted')}>{pending && <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}{t('trust.accept')}</Button>}<Button size='sm' variant='outline' disabled={pending} onClick={() => onResolve('leave_unresolved')}>{t('trust.leaveUnresolved')}</Button><Button size='sm' variant='ghost' disabled={pending} onClick={() => onResolve('dismissed')}>{t('trust.dismiss')}</Button></div></>}
  </article>;
}

function reviewOptions(item: SemanticReviewItem): Array<{ value: string; label: string }> {
  if (item.kind === 'ambiguous_relation' && Array.isArray(item.details.targetEntityIds)) {
    const labels = Array.isArray(item.details.targetLabels) ? item.details.targetLabels : [];
    return item.details.targetEntityIds.map((value, index) => ({ value: String(value), label: String(labels[index] ?? value) }));
  }
  if (item.kind === 'source_conflict') {
    return [item.details.preferredMappingId, item.details.conflictingMappingId]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => ({ value, label: value }));
  }
  return [];
}
