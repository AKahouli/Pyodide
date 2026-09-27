import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticReadiness } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { ValidationIssue } from '../../types';
import { ReviewQueueList, type ReviewQueueHandlers } from './ReviewQueuePanel';

export function SemanticTrustPanel({ modelId, canEdit, validation = [], canRunCheck = false, checking = false, onRunCheck, onClose, onRepairMapping, onOpenItem, onFixValues }: Readonly<ReviewQueueHandlers & {
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
  const focus = useSemanticModelEditorStore((state) => state.focus);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const restoreFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const readiness = useSemanticReadiness(modelId);
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
  const content = (closeControl?: ReactNode) => <>
    <div className='relative flex items-center justify-between border-b p-4 pr-20 sm:pr-4'><div><h2 className='flex items-center gap-2 font-semibold'><ShieldCheck className='h-4 w-4 text-primary' />{t('trust.title')}</h2><p className='text-xs text-muted-foreground'>{t('trust.description')}</p></div>{closeControl}</div>
    <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-4'>
      <section>{readiness.isLoading ? <div className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-5 w-5 animate-spin' />{t('readinessState.loading')}</div> : readiness.isError ? <p className='rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>{t('readinessState.unavailable')}</p> : readiness.data?.status === 'not_configured' ? <div className='rounded-xl border border-dashed p-4'><p className='font-semibold'>{t('readinessState.notConfigured')}</p><p className='mt-1 text-sm text-muted-foreground'>{t('readinessState.notConfiguredAction')}</p></div> : readiness.data && <><div className='flex items-end justify-between'><div><p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>{t('trust.readiness')}</p><p className='mt-1 text-3xl font-semibold'>{readiness.data.score}%</p></div><p className='text-xs text-muted-foreground'>{t('trust.areaCount', { complete: readiness.data.completeAreas, total: readiness.data.totalAreas })}</p></div><div className='mt-3 h-2 overflow-hidden rounded-full bg-muted'><div className='h-full rounded-full bg-primary transition-[width]' style={{ width: `${readiness.data.score}%` }} /></div><div className='mt-3 space-y-2'>{readiness.data.areas.map((area) => <div key={area.key} className='flex gap-2 rounded-lg border p-2.5'>{area.complete ? <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-emerald-600' /> : <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' />}<div className='min-w-0 flex-1'><p className='text-sm font-medium'>{t(`trust.area.${area.key}`)}</p>{!area.complete && <p className='text-xs text-muted-foreground'>{t(`trust.issue.${area.key}`)}</p>}</div>{!area.complete && area.targetId && <Button size='sm' variant='outline' className='h-7 shrink-0 px-2 text-xs' onClick={() => { focus(area.targetId!); onClose(); }}>{t('trust.fixArea')}</Button>}</div>)}</div></>}</section>
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
      <section aria-label={t('reviewQueue.title')}>
        <h3 className='font-semibold'>{t('reviewQueue.title')}</h3>
        <p className='text-xs text-muted-foreground'>{t('reviewQueue.description')}</p>
        <ReviewQueueList modelId={modelId} canEdit={canEdit} onRepairMapping={onRepairMapping} onOpenItem={(id) => { onOpenItem ? onOpenItem(id) : focus(id); onClose(); }} onFixValues={(conceptId) => { onFixValues?.(conceptId); onClose(); }} />
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
