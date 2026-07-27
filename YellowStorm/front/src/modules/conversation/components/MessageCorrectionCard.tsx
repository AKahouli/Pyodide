import { AlertTriangle, CheckCircle2, Loader2, Sparkles, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { ActiveAnswerVersion, ResponseCorrectionWorkflow } from '../types';

const panelClassName = 'mt-2 border-t border-border/60 pt-2';

export function MessageCorrectionCard({ workflow, displayedVersion, onVersionChange }: Readonly<{
  workflow?: ResponseCorrectionWorkflow;
  displayedVersion: ActiveAnswerVersion;
  onVersionChange: (version: ActiveAnswerVersion) => void;
}>) {
  const { t } = useModuleTranslation('conversation');
  if (!workflow) return null;
  const progress = workflow.status === 'queued' || workflow.status === 'correcting' || workflow.status === 're_evaluating';
  const Icon = progress ? Loader2 : workflow.status === 'corrected' ? CheckCircle2 : workflow.status === 'human_review_required' ? UserCheck : AlertTriangle;
  const warning = workflow.status === 'failed' ? t('correction.publishWarning') : workflow.status === 'abstained' ? t('correction.abstentionReason') : null;

  return (
    <section className={panelClassName} aria-label={t('correction.title')} role={progress ? 'status' : undefined} aria-live={progress ? 'polite' : undefined}>
      <div className="rounded-lg bg-muted/35 px-3 py-2.5 ring-1 ring-inset ring-border/45">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
            {progress ? <Icon className="size-3.5 animate-spin" /> : workflow.status === 'corrected' ? <Sparkles className="size-3.5" /> : <Icon className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('correction.title')}</p>
            <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">{t(`correction.status.${workflow.status}` as const)}</p>
          {workflow.status === 'corrected' ? (
            workflow.strategy === 'corrective_replay' ? (
              <div className="mt-1.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{t('correction.strategy.correctiveReplay')}</p>
                <p className="mt-0.5 leading-relaxed">{t('correction.strategy.correctiveReplayDetail')}</p>
              </div>
            ) : <details className="group mt-1.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('correction.correctedCount', { count: workflow.appliedCorrections?.length || 0 })}</summary>
              <ul className="mt-2 space-y-2 border-l border-border pl-3">
                {workflow.appliedCorrections?.map((correction, index) => <li key={`${correction.claim}-${index}`}><span className="font-medium leading-relaxed text-foreground">{correction.claim}</span><span className="mt-0.5 block leading-relaxed">{correction.explanation}</span></li>)}
              </ul>
            </details>
          ) : null}
            {warning ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{warning}</p> : null}
            {workflow.remainingUncertainties?.length ? <p className="mt-1.5 text-xs text-muted-foreground">{t('correction.uncertainties', { count: workflow.remainingUncertainties.length })}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {workflow.showOriginalAnswer && workflow.activeVersion !== 'original' && displayedVersion !== 'original' ? <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onVersionChange('original')}>{t('correction.viewOriginal')}</Button> : null}
              {workflow.status === 'corrected' && displayedVersion !== 'corrected' ? <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onVersionChange('corrected')}>{t('correction.viewCorrected')}</Button> : null}
              {workflow.activeVersion === 'abstention' && displayedVersion === 'original' ? <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onVersionChange('abstention')}>{t('correction.viewAbstention')}</Button> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
