import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  SearchX,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { DisplayedAnswerVersion, ReliabilityClaimStatus, ReliabilityEvaluation, ReliabilityFinding, ResponseCorrectionAttempt, ResponseCorrectionWorkflow } from '../types';
import { attemptVersion } from '../utils/answer-version';

const panelClassName = 'mx-2 mb-2 shrink-0 rounded-xl border border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 md:mx-4';

const claimGroupOrder: ReliabilityClaimStatus[] = [
  'contradicted',
  'unsupported',
  'partially_supported',
  'supported',
];

const groupIcons = {
  contradicted: XCircle,
  unsupported: SearchX,
  partially_supported: CircleDashed,
  supported: CheckCircle2,
} as const;

const groupStyles = {
  contradicted: 'text-destructive',
  unsupported: 'text-amber-600 dark:text-amber-400',
  partially_supported: 'text-sky-600 dark:text-sky-400',
  supported: 'text-emerald-600 dark:text-emerald-400',
} as const;

interface MessageReliabilityCardProps {
  evaluation?: ReliabilityEvaluation;
  originalEvaluation?: ReliabilityEvaluation;
  correctionWorkflow?: ResponseCorrectionWorkflow;
  displayedVersion?: DisplayedAnswerVersion;
  onVersionChange?: (version: DisplayedAnswerVersion) => void;
}

export function MessageReliabilityCard({ evaluation, originalEvaluation, correctionWorkflow, displayedVersion = 'original', onVersionChange }: Readonly<MessageReliabilityCardProps>) {
  const { t, language } = useModuleTranslation('conversation');
  const [open, setOpen] = useState(false);
  const correctionContent = <EvaluationHistory workflow={correctionWorkflow} originalEvaluation={originalEvaluation} displayedVersion={displayedVersion} onVersionChange={onVersionChange} language={language} />;
  if (!evaluation) {
    if (!correctionWorkflow) return null;
    return <ReliabilityPanelHeader icon={<AlertTriangle className='size-4 text-muted-foreground' />} title={t('reliability.unavailable')} description={t('reliability.notRecorded')}>{correctionContent}</ReliabilityPanelHeader>;
  }

  if (evaluation.status === 'pending') {
    return (
      <ReliabilityPanelHeader
        icon={<Loader2 className='size-5 animate-spin text-primary [animation-duration:1.1s]' />}
        title={t('reliability.pendingTitle')}
        description={t('reliability.pendingDescription')}
      >
        {correctionContent}
      </ReliabilityPanelHeader>
    );
  }
  if (evaluation.status === 'insufficient_evidence') {
    return <ReliabilityPanelHeader title={t('reliability.notScored')} description={t('reliability.insufficientEvidence')}>{correctionContent}</ReliabilityPanelHeader>;
  }
  if (evaluation.status === 'not_applicable') {
    return <ReliabilityPanelHeader title={t('reliability.notApplicable')} description={t('reliability.noClaims')}>{correctionContent}</ReliabilityPanelHeader>;
  }
  if (evaluation.status === 'failed') {
    return <ReliabilityPanelHeader icon={<AlertTriangle className='size-4 text-muted-foreground' />} title={t('reliability.unavailable')} description={t('reliability.unavailableDescription')}>{correctionContent}</ReliabilityPanelHeader>;
  }
  if (evaluation.score === undefined || !evaluation.label || !evaluation.claimCounts) return null;

  const counts = evaluation.claimCounts;
  const label = t(`reliability.labels.${evaluation.label}`);
  // Only the complete claims array may drive groups; findings are truncated on older records.
  const groups = claimGroupOrder
    .map((status) => ({ status, claims: evaluation.claims?.filter((claim) => claim.status === status) || [] }))
    .filter((group) => group.claims.length > 0);
  const defaultOpenGroups = groups
    .filter((group) => group.status !== 'supported')
    .map((group) => group.status);
  const summary = counts.contradicted > 0
    ? t('reliability.summaries.conflicts', { count: counts.contradicted })
    : counts.unsupported > 0
      ? t('reliability.summaries.missing', { count: counts.unsupported })
      : counts.partiallySupported > 0
        ? t('reliability.summaries.partialSupport')
        : t('reliability.summaries.allSupported');

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={panelClassName}>
      <div className='flex min-w-0 items-center gap-3 px-1'>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          <span className='absolute inset-1 rounded-full bg-primary/20 ring-1 ring-primary/40' />
          <ShieldCheck className='size-4 text-primary' />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium text-foreground'>{t('reliability.title')}</p>
          <p className='text-xs text-muted-foreground'>{t('reliability.supportedCount', { supported: counts.supported, total: counts.total })}</p>
        </div>
        <Badge variant='secondary' className='shrink-0 tabular-nums'>{evaluation.score}/100</Badge>
        <CollapsibleTrigger className='inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted' aria-label={t('reliability.claimsAria', { count: counts.total })}>
          {t('reliability.claimsTrigger', { count: counts.total })}
          <ChevronDown className='size-3.5 transition-transform data-[state=open]:rotate-180' />
        </CollapsibleTrigger>
      </div>

      <EvaluationHistory workflow={correctionWorkflow} originalEvaluation={originalEvaluation} displayedVersion={displayedVersion} onVersionChange={onVersionChange} language={language} />

      <CollapsibleContent className='pt-3'>
        <div className='max-h-96 space-y-3 overflow-y-auto border-t pt-3 pr-1'>
          <div className='rounded-lg bg-muted/50 p-3'>
            <p className='text-sm font-medium text-foreground'>{label}</p>
            <p className='mt-1 text-sm text-muted-foreground'>{summary}</p>
          </div>

          {groups.length > 0 ? (
            <Accordion type='multiple' defaultValue={defaultOpenGroups} className='space-y-2'>
              {groups.map((group) => (
                <ClaimGroup key={group.status} status={group.status} claims={group.claims} />
              ))}
            </Accordion>
          ) : evaluation.findings?.length ? (
            <LegacyFindings findings={evaluation.findings} />
          ) : null}

          <p className='text-xs leading-relaxed text-muted-foreground'>{t('reliability.disclaimer')}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ClaimGroup({ status, claims }: Readonly<{ status: ReliabilityClaimStatus; claims: ReliabilityFinding[] }>) {
  const { t } = useModuleTranslation('conversation');
  const Icon = groupIcons[status];
  return (
    <AccordionItem value={status} className='rounded-lg border bg-muted/20 px-3 last:border-b'>
      <AccordionTrigger className='py-3 hover:no-underline'>
        <span className='flex min-w-0 items-center gap-2'>
          <Icon className={cn('size-4 shrink-0', groupStyles[status])} aria-hidden='true' />
          <span className='text-left'>{t(`reliability.groups.${status}`, { count: claims.length })}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className='space-y-2 pb-3'>
        {claims.map((claim, index) => (
          <article key={`${claim.claim}-${index}`} className='rounded-md border bg-background/80 p-3'>
            <div className='flex items-start gap-2'>
              <p className='min-w-0 flex-1 text-sm font-medium leading-relaxed text-foreground'>{claim.claim}</p>
              {claim.importance === 'critical' && <span className='shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive'>{t('reliability.keyClaim')}</span>}
            </div>
            <p className='mt-1.5 text-xs leading-relaxed text-muted-foreground'>{claim.explanation}</p>
          </article>
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}

function LegacyFindings({ findings }: Readonly<{ findings: ReliabilityFinding[] }>) {
  const { t } = useModuleTranslation('conversation');
  return (
    <div className='rounded-lg border bg-muted/20 p-3'>
      <p className='text-sm font-medium'>{t('reliability.legacyFindings')}</p>
      <ul className='mt-2 space-y-2'>
        {findings.map((finding, index) => <li key={`${finding.claim}-${index}`} className='flex gap-2 text-sm'><AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400' /><span>{finding.explanation}</span></li>)}
      </ul>
    </div>
  );
}

function EvaluationHistory({ workflow, originalEvaluation, displayedVersion, onVersionChange, language }: Readonly<{
  workflow?: ResponseCorrectionWorkflow;
  originalEvaluation?: ReliabilityEvaluation;
  displayedVersion: DisplayedAnswerVersion;
  onVersionChange?: (version: DisplayedAnswerVersion) => void;
  language?: string;
}>) {
  const { t } = useModuleTranslation('conversation');
  const attempts = workflow?.attempts || [];
  const showCorrectedFallback = workflow?.status === 'corrected' && !attempts.length && !!workflow.correctedComponents?.length;
  const showAbstention = workflow?.activeVersion === 'abstention';
  if (!originalEvaluation && !attempts.length && !workflow) return null;
  return <div className='mt-2 space-y-1.5 rounded-lg border bg-muted/20 p-2.5'>
    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('reliability.timelineTitle')}</p>
    {workflow ? <WorkflowStatus workflow={workflow} hasAttempts={attempts.length > 0} /> : null}
    {originalEvaluation ? <EvaluationOccurrence
      label={t('reliability.originalEvaluation')}
      evaluation={originalEvaluation}
      selected={displayedVersion === 'original'}
      timestamp={originalEvaluation.evaluatedAt || originalEvaluation.requestedAt}
      language={language}
      viewLabel={t('correction.viewOriginal')}
      onSelect={onVersionChange ? () => onVersionChange('original') : undefined}
    /> : null}
    {attempts.map((attempt, index) => <EvaluationOccurrence
      key={attempt.attemptId}
      label={t('correction.attemptLabel', { count: attempt.attemptNumber })}
      evaluation={attempt.evaluation}
      fallbackStatus={attempt.status}
      selected={displayedVersion === attemptVersion(attempt.attemptId)}
      timestamp={attempt.evaluation?.evaluatedAt || attempt.evaluation?.requestedAt || attempt.completedAt || attempt.generatedAt || attempt.createdAt}
      language={language}
      viewLabel={t('correction.viewAttempt', { count: attempt.attemptNumber })}
      onSelect={attempt.components?.length && onVersionChange ? () => onVersionChange(attemptVersion(attempt.attemptId)) : undefined}
      details={workflow ? <AttemptDetails attempt={attempt} workflow={workflow} showWorkflowWarning={index === attempts.length - 1} /> : undefined}
    />)}
    {showCorrectedFallback && workflow ? <EvaluationOccurrence
      label={t('correction.status.corrected')}
      evaluation={workflow.finalReliabilityEvaluation}
      fallbackStatus={workflow.status}
      selected={displayedVersion === 'corrected'}
      timestamp={workflow.finalReliabilityEvaluation?.evaluatedAt || workflow.finalReliabilityEvaluation?.requestedAt || workflow.completedAt}
      language={language}
      viewLabel={t('correction.viewCorrected')}
      onSelect={onVersionChange ? () => onVersionChange('corrected') : undefined}
      details={<CorrectionOutcomeDetails workflow={workflow} />}
    /> : null}
    {showAbstention && workflow ? <EvaluationOccurrence
      label={t('correction.status.abstained')}
      fallbackStatus={workflow.status}
      selected={displayedVersion === 'abstention'}
      timestamp={workflow.completedAt}
      language={language}
      viewLabel={t('correction.viewAbstention')}
      onSelect={onVersionChange ? () => onVersionChange('abstention') : undefined}
      details={<CorrectionOutcomeDetails workflow={workflow} />}
    /> : null}
  </div>;
}

function WorkflowStatus({ workflow, hasAttempts }: Readonly<{ workflow: ResponseCorrectionWorkflow; hasAttempts: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const progress = workflow.status === 'queued' || workflow.status === 'correcting' || workflow.status === 're_evaluating';
  const showSummary = progress || workflow.status === 'human_review_required' || (!hasAttempts && workflow.status === 'failed');
  if (!showSummary) return null;

  return <div role={progress ? 'status' : undefined} aria-live={progress ? 'polite' : undefined} className='flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground'>
    {progress ? <Loader2 className='mt-0.5 size-3.5 shrink-0 animate-spin text-primary' aria-hidden='true' /> : <AlertTriangle className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400' aria-hidden='true' />}
    <div className='min-w-0 space-y-1'>
      <p className='font-medium text-foreground'>{t(`correction.status.${workflow.status}` as const)}</p>
      {!hasAttempts && workflow.status === 'failed' ? <p className='leading-relaxed'>{t('correction.publishWarning')}</p> : null}
      {!hasAttempts && workflow.failureCode ? <p className='font-mono text-[11px]'>{t('correction.failureCode', { code: workflow.failureCode })}</p> : null}
    </div>
  </div>;
}

function CorrectionOutcomeDetails({ workflow }: Readonly<{ workflow: ResponseCorrectionWorkflow }>) {
  const { t } = useModuleTranslation('conversation');
  return <div className='basis-full space-y-1.5 border-t border-border/60 pt-2 text-xs text-muted-foreground'>
    {workflow.status === 'abstained' ? <p className='leading-relaxed'>{t('correction.abstentionReason')}</p> : null}
    {workflow.status === 'corrected' && workflow.strategy === 'corrective_replay' ? <>
      <p className='font-medium text-foreground'>{t('correction.strategy.correctiveReplay')}</p>
      <p className='leading-relaxed'>{t('correction.strategy.correctiveReplayDetail')}</p>
    </> : null}
    {workflow.status === 'corrected' && workflow.strategy !== 'corrective_replay' && workflow.appliedCorrections?.length ? <ul className='space-y-1.5 border-l border-border pl-3'>
      {workflow.appliedCorrections.map((correction, index) => <li key={`${correction.claim}-${index}`}><span className='font-medium text-foreground'>{correction.claim}</span><span className='block leading-relaxed'>{correction.explanation}</span></li>)}
    </ul> : null}
    {workflow.remainingUncertainties?.length ? <p>{t('correction.uncertainties', { count: workflow.remainingUncertainties.length })}</p> : null}
  </div>;
}

function AttemptDetails({ attempt, workflow, showWorkflowWarning }: Readonly<{
  attempt: ResponseCorrectionAttempt;
  workflow: ResponseCorrectionWorkflow;
  showWorkflowWarning: boolean;
}>) {
  const { t } = useModuleTranslation('conversation');
  const reasons = attempt.policyReasons.filter((reason) => reason !== 'policy_requirements_met');
  const workflowWarning = showWorkflowWarning
    ? workflow.status === 'failed'
      ? t('correction.publishWarning')
      : workflow.status === 'abstained'
        ? t('correction.abstentionReason')
        : null
    : null;

  return <div className='basis-full space-y-1.5 border-t border-border/60 pt-2 text-xs text-muted-foreground'>
    <div className='flex items-center gap-1.5 font-medium text-foreground'>
      {(attempt.status === 'failed' || attempt.status === 'rejected') && <AlertTriangle className='size-3.5 shrink-0 text-amber-600 dark:text-amber-400' aria-hidden='true' />}
      <span>{t(`correction.attemptStatus.${attempt.status}` as const)}</span>
    </div>
    {workflowWarning ? <p className='leading-relaxed'>{workflowWarning}</p> : null}
    {reasons.map((reason) => <p key={reason} className='leading-relaxed'>
      {reason === 'candidate_generation_failed' && attempt.components?.length
        ? t('correction.reason.candidate_evaluation_not_started')
        : t(`correction.reason.${reason}` as const, { threshold: workflow.threshold, score: attempt.evaluation?.score ?? 0, originalScore: workflow.originalScore ?? 0 })}
    </p>)}
    {attempt.status === 'accepted' && attempt.strategy === 'corrective_replay' ? <>
      <p className='font-medium text-foreground'>{t('correction.strategy.correctiveReplay')}</p>
      <p className='leading-relaxed'>{t('correction.strategy.correctiveReplayDetail')}</p>
    </> : null}
    {attempt.status === 'accepted' && attempt.strategy !== 'corrective_replay' && attempt.appliedCorrections?.length ? <ul className='space-y-1.5 border-l border-border pl-3'>
      {attempt.appliedCorrections.map((correction, index) => <li key={`${correction.claim}-${index}`}><span className='font-medium text-foreground'>{correction.claim}</span><span className='block leading-relaxed'>{correction.explanation}</span></li>)}
    </ul> : null}
    {attempt.remainingUncertainties?.length ? <p>{t('correction.uncertainties', { count: attempt.remainingUncertainties.length })}</p> : null}
    {attempt.failureCode ? <p className='font-mono text-[11px]'>{t('correction.failureCode', { code: attempt.failureCode })}</p> : null}
    {showWorkflowWarning && workflow.failureCode && workflow.failureCode !== attempt.failureCode ? <p className='font-mono text-[11px]'>{t('correction.failureCode', { code: workflow.failureCode })}</p> : null}
  </div>;
}

function EvaluationOccurrence({ label, evaluation, fallbackStatus, selected, timestamp, language, viewLabel, onSelect, details }: Readonly<{
  label: string;
  evaluation?: ReliabilityEvaluation;
  fallbackStatus?: string;
  selected: boolean;
  timestamp?: string;
  language?: string;
  viewLabel: string;
  onSelect?: () => void;
  details?: React.ReactNode;
}>) {
  const date = timestamp ? new Date(timestamp) : undefined;
  const formatted = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
    : null;
  return <article aria-current={selected ? 'true' : undefined} className={cn('flex w-full flex-wrap items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2 text-xs', selected && 'bg-muted ring-1 ring-border')}>
    <span className='font-medium text-foreground'>{label}</span>
    {evaluation?.score === undefined
      ? <span className='ml-auto text-muted-foreground'>{evaluation?.status || fallbackStatus}</span>
      : <Badge variant='outline' className='ml-auto h-5 px-1.5 tabular-nums'>{evaluation.score}/100</Badge>}
    {formatted ? <span className='basis-full text-[11px] text-muted-foreground'>{formatted}</span> : null}
    {details}
    <div className='basis-full'>
      <Button type='button' variant='outline' size='sm' className='h-7 px-2.5 text-xs' onClick={onSelect} disabled={!onSelect || selected} aria-current={selected ? 'true' : undefined}>{viewLabel}</Button>
    </div>
  </article>;
}

function ReliabilityPanelHeader({ icon, title, description, children }: Readonly<{ icon?: React.ReactNode; title: string; description?: string; children?: React.ReactNode }>) {
  return (
    <div className={panelClassName}>
      <div className='flex min-w-0 items-center gap-3 px-1'>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          <span className='absolute inset-1 rounded-full bg-primary/20 ring-1 ring-primary/40' />
          {icon || <ShieldCheck className='size-4 text-primary' />}
        </span>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium text-foreground'>{title}</p>
          {description && <p className='text-xs leading-relaxed text-muted-foreground'>{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
