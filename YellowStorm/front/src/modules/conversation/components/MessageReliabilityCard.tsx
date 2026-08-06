import { useEffect, useState, type CSSProperties } from 'react';
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
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useApiAction } from '@/lib/use-api-action';
import { rerunReliabilityEvaluation } from '../api';
import type { DisplayedAnswerVersion, ReliabilityClaimStatus, ReliabilityEvaluation, ReliabilityFinding, ResponseCorrectionAttempt, ResponseCorrectionWorkflow } from '../types';
import { attemptVersion } from '../utils/answer-version';
import { conversationPanelClassName } from './conversation-panel-styles';

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
  conversationId?: string;
  messageId?: string;
  evaluation?: ReliabilityEvaluation;
  originalEvaluation?: ReliabilityEvaluation;
  correctionWorkflow?: ResponseCorrectionWorkflow;
  displayedVersion?: DisplayedAnswerVersion;
  onVersionChange?: (version: DisplayedAnswerVersion) => void;
}

export function MessageReliabilityCard({ conversationId, messageId, evaluation, originalEvaluation, correctionWorkflow, displayedVersion = 'original', onVersionChange }: Readonly<MessageReliabilityCardProps>) {
  const { t, language } = useModuleTranslation('conversation');
  const { execute: rerun, isLoading: isRerunning } = useApiAction(rerunReliabilityEvaluation, {
    showSuccessToast: true,
    successMessage: t('reliability.rerunQueued'),
  });
  const correctionInProgress = correctionWorkflow?.status === 'queued'
    || correctionWorkflow?.status === 'correcting'
    || correctionWorkflow?.status === 're_evaluating';
  const rerunDisabled = isRerunning || evaluation?.status === 'pending' || correctionInProgress;
  const rerunAction = conversationId && messageId ? <Button
    type='button'
    variant='outline'
    size='sm'
    className='min-h-11 shrink-0 px-3 text-xs md:min-h-7 md:px-2'
    onClick={() => void rerun(conversationId, messageId)}
    disabled={rerunDisabled}
    aria-label={t('reliability.rerunAria')}
  >
    {isRerunning && <Loader2 className='mr-1 size-3 animate-spin' aria-hidden='true' />}
    {t('reliability.rerun')}
  </Button> : null;
  const history = <EvaluationHistory workflow={correctionWorkflow} originalEvaluation={originalEvaluation} fallbackEvaluation={evaluation} displayedVersion={displayedVersion} onVersionChange={onVersionChange} language={language} />;
  if (!evaluation) {
    if (!correctionWorkflow && !rerunAction) return null;
    return <ReliabilityPanel action={rerunAction} icon={<AlertTriangle className='size-4 text-muted-foreground' />} title={t('reliability.unavailable')} description={t('reliability.notRecorded')}>{history}</ReliabilityPanel>;
  }

  if (evaluation.status === 'pending') {
    return (
      <ReliabilityPanel
        icon={<Loader2 className='size-5 animate-spin text-primary [animation-duration:1.1s]' />}
        title={t('reliability.pendingTitle')}
        description={t('reliability.pendingDescription')}
        action={rerunAction}
      >
        {history}
      </ReliabilityPanel>
    );
  }
  if (evaluation.status === 'insufficient_evidence') {
    return <ReliabilityPanel action={rerunAction} title={t('reliability.notScored')} description={t('reliability.insufficientEvidence')}>{history}</ReliabilityPanel>;
  }
  if (evaluation.status === 'not_applicable') {
    return <ReliabilityPanel action={rerunAction} title={t('reliability.notApplicable')} description={t('reliability.noClaims')}>{history}</ReliabilityPanel>;
  }
  if (evaluation.status === 'failed') {
    return <ReliabilityPanel action={rerunAction} icon={<AlertTriangle className='size-4 text-muted-foreground' />} title={t('reliability.unavailable')} description={t('reliability.unavailableDescription')}>{history}</ReliabilityPanel>;
  }
  if (evaluation.score === undefined || !evaluation.label || !evaluation.claimCounts) return null;

  const counts = evaluation.claimCounts;
  return (
    <ReliabilityPanel
      action={rerunAction}
      title={t('reliability.title')}
      description={t('reliability.supportedCount', { supported: counts.supported, total: counts.total })}
      score={<ScoreIndicator score={evaluation.score} size='large' />}
    >
      {history}
    </ReliabilityPanel>
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

function ScoreIndicator({ score, size = 'small' }: Readonly<{ score: number; size?: 'small' | 'large' }>) {
  const { t } = useModuleTranslation('conversation');
  const normalizedScore = Math.round(Math.max(0, Math.min(100, score)));
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedScore / 100);
  const diameterClassName = size === 'large' ? 'size-11' : 'size-8';
  const textClassName = size === 'large' ? 'text-sm' : 'text-[10px]';
  const scoreBand = normalizedScore > 70 ? 'positive' : 'caution';
  const scoreColor = normalizedScore > 70
    ? `color-mix(in oklch, var(--reliability-positive) ${100 - ((normalizedScore - 71) / 29) * 100}%, var(--reliability-excellent))`
    : `color-mix(in oklch, var(--reliability-critical) ${100 - (normalizedScore / 70) * 100}%, var(--reliability-warning))`;

  return <div
    role='meter'
    aria-label={t('reliability.scoreAria', { score: normalizedScore })}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={normalizedScore}
    data-score-band={scoreBand}
    className={cn('relative shrink-0 text-[var(--reliability-score-color)]', diameterClassName)}
    style={{ '--reliability-score-color': scoreColor } as CSSProperties}
  >
    <svg viewBox='0 0 36 36' className='size-full -rotate-90' aria-hidden='true'>
      <circle cx='18' cy='18' r={radius} fill='none' stroke='currentColor' strokeWidth='4' className='opacity-25' />
      <circle cx='18' cy='18' r={radius} fill='none' stroke='currentColor' strokeWidth='4' strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap='butt' />
    </svg>
    <span className={cn('absolute inset-0 flex items-center justify-center font-semibold tabular-nums', textClassName)}>{normalizedScore}</span>
  </div>;
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

function EvaluationDetails({ evaluation }: Readonly<{ evaluation?: ReliabilityEvaluation }>) {
  const { t } = useModuleTranslation('conversation');
  if (!evaluation) return null;
  if (evaluation.status !== 'completed') {
    const description = evaluation.status === 'pending'
      ? t('reliability.pendingDescription')
      : evaluation.status === 'insufficient_evidence'
        ? t('reliability.insufficientEvidence')
        : evaluation.status === 'not_applicable'
          ? t('reliability.noClaims')
          : t('reliability.unavailableDescription');
    return <div className='border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground'>{description}</div>;
  }

  const groups = claimGroupOrder
    .map((status) => ({ status, claims: evaluation.claims?.filter((claim) => claim.status === status) || [] }))
    .filter((group) => group.claims.length > 0);
  const counts = evaluation.claimCounts;
  const summary = counts?.contradicted
    ? t('reliability.summaries.conflicts', { count: counts.contradicted })
    : counts?.unsupported
      ? t('reliability.summaries.missing', { count: counts.unsupported })
      : counts?.partiallySupported
        ? t('reliability.summaries.partialSupport')
        : t('reliability.summaries.allSupported');

  return <div className='max-h-96 space-y-3 overflow-y-auto border-t border-border/60 pt-3 pr-1'>
    {evaluation.label ? <div className='rounded-lg bg-muted/50 p-3'>
      <p className='text-sm font-medium text-foreground'>{t(`reliability.labels.${evaluation.label}`)}</p>
      <p className='mt-1 text-sm text-muted-foreground'>{summary}</p>
    </div> : null}
    {groups.length ? <Accordion type='multiple' className='space-y-2'>
      {groups.map((group) => <ClaimGroup key={group.status} status={group.status} claims={group.claims} />)}
    </Accordion> : evaluation.findings?.length ? <LegacyFindings findings={evaluation.findings} /> : null}
    <p className='text-xs leading-relaxed text-muted-foreground'>{t('reliability.disclaimer')}</p>
  </div>;
}

function EvaluationHistory({ workflow, originalEvaluation, fallbackEvaluation, displayedVersion, onVersionChange, language }: Readonly<{
  workflow?: ResponseCorrectionWorkflow;
  originalEvaluation?: ReliabilityEvaluation;
  fallbackEvaluation?: ReliabilityEvaluation;
  displayedVersion: DisplayedAnswerVersion;
  onVersionChange?: (version: DisplayedAnswerVersion) => void;
  language?: string;
}>) {
  const { t } = useModuleTranslation('conversation');
  const attempts = workflow?.attempts || [];
  const resolvedOriginalEvaluation = originalEvaluation || (displayedVersion === 'original' ? fallbackEvaluation : undefined);
  const showCorrectedFallback = workflow?.status === 'corrected' && !attempts.length && !!workflow.correctedComponents?.length;
  const showAbstention = workflow?.activeVersion === 'abstention';
  const originalSequence = resolvedOriginalEvaluation ? 1 : 0;
  const nextSequence = originalSequence + attempts.length;
  if (!resolvedOriginalEvaluation && !attempts.length && !workflow) return null;
  return <div className='mt-2 space-y-1.5 rounded-lg border bg-muted/20 p-2.5'>
    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('reliability.timelineTitle')}</p>
    {workflow ? <WorkflowStatus workflow={workflow} hasAttempts={attempts.length > 0} /> : null}
    {resolvedOriginalEvaluation ? <EvaluationOccurrence
      label={t('reliability.originalEvaluation')}
      sequence={originalSequence}
      evaluation={resolvedOriginalEvaluation}
      selected={displayedVersion === 'original'}
      timestamp={resolvedOriginalEvaluation.evaluatedAt || resolvedOriginalEvaluation.requestedAt}
      language={language}
      viewLabel={t('correction.viewAnswer')}
      onSelect={onVersionChange ? () => onVersionChange('original') : undefined}
      details={<EvaluationDetails evaluation={resolvedOriginalEvaluation} />}
    /> : null}
    {attempts.map((attempt, index) => <EvaluationOccurrence
      key={attempt.attemptId}
      label={t('correction.attemptLabel', { count: attempt.attemptNumber })}
      sequence={originalSequence + index + 1}
      evaluation={attempt.evaluation}
      fallbackStatus={attempt.status}
      selected={displayedVersion === attemptVersion(attempt.attemptId)}
      timestamp={attempt.evaluation?.evaluatedAt || attempt.evaluation?.requestedAt || attempt.completedAt || attempt.generatedAt || attempt.createdAt}
      language={language}
      viewLabel={t('correction.viewAnswer')}
      onSelect={attempt.components?.length && onVersionChange ? () => onVersionChange(attemptVersion(attempt.attemptId)) : undefined}
      details={<>
        {workflow ? <AttemptDetails attempt={attempt} workflow={workflow} showWorkflowWarning={index === attempts.length - 1} /> : null}
        <EvaluationDetails evaluation={attempt.evaluation} />
      </>}
    />)}
    {showCorrectedFallback && workflow ? <EvaluationOccurrence
      label={t('correction.status.corrected')}
      sequence={nextSequence + 1}
      evaluation={workflow.finalReliabilityEvaluation}
      fallbackStatus={workflow.status}
      selected={displayedVersion === 'corrected'}
      timestamp={workflow.finalReliabilityEvaluation?.evaluatedAt || workflow.finalReliabilityEvaluation?.requestedAt || workflow.completedAt}
      language={language}
      viewLabel={t('correction.viewAnswer')}
      onSelect={onVersionChange ? () => onVersionChange('corrected') : undefined}
      details={<><CorrectionOutcomeDetails workflow={workflow} /><EvaluationDetails evaluation={workflow.finalReliabilityEvaluation} /></>}
    /> : null}
    {showAbstention && workflow ? <EvaluationOccurrence
      label={t('correction.status.abstained')}
      sequence={nextSequence + (showCorrectedFallback ? 2 : 1)}
      fallbackStatus={workflow.status}
      selected={displayedVersion === 'abstention'}
      timestamp={workflow.completedAt}
      language={language}
      viewLabel={t('correction.viewAnswer')}
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

function EvaluationOccurrence({ label, sequence, evaluation, fallbackStatus, selected, timestamp, language, viewLabel, onSelect, details }: Readonly<{
  label: string;
  sequence: number;
  evaluation?: ReliabilityEvaluation;
  fallbackStatus?: string;
  selected: boolean;
  timestamp?: string;
  language?: string;
  viewLabel: string;
  onSelect?: () => void;
  details?: React.ReactNode;
}>) {
  const { t } = useModuleTranslation('conversation');
  const hasDetails = Boolean(details);
  const [open, setOpen] = useState(selected && hasDetails);
  useEffect(() => {
    if (selected && hasDetails) setOpen(true);
  }, [selected, hasDetails]);
  const date = timestamp ? new Date(timestamp) : undefined;
  const formatted = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
    : null;
  return <Collapsible open={open} onOpenChange={setOpen} aria-current={selected ? 'true' : undefined} className={cn('w-full rounded-md border bg-background/60 px-2.5 py-2 text-xs', selected && 'bg-muted ring-1 ring-border')}>
    <div className='flex min-w-0 items-center gap-0.5 md:gap-2'>
      <span className='shrink-0 font-medium text-foreground'>{sequence}.</span>
      <span className='w-6 shrink-0 truncate font-medium text-foreground md:w-auto md:max-w-[35%]'>{label}</span>
      {formatted ? <span className='w-10 shrink-0 truncate text-[11px] text-muted-foreground md:min-w-0 md:flex-1 md:w-auto'>{formatted}</span> : <span className='flex-1' />}
      {evaluation?.score === undefined
        ? <span className='shrink-0 text-muted-foreground'>{evaluation?.status || fallbackStatus}</span>
        : <ScoreIndicator score={evaluation.score} />}
      {hasDetails ? <CollapsibleTrigger className='inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-180' aria-label={t('reliability.evaluationDetailsAria', { label })}>
        <ChevronDown className='size-3.5 transition-transform' />
      </CollapsibleTrigger> : null}
      <Button type='button' variant='outline' size='sm' className='h-6 shrink-0 px-1 text-[10px] md:h-7 md:px-2.5 md:text-xs' onClick={onSelect} disabled={!onSelect || selected} aria-label={t('reliability.viewAnswerAria', { label })} aria-current={selected ? 'true' : undefined}>{viewLabel}</Button>
    </div>
    {hasDetails ? <CollapsibleContent className='pt-2'>{details}</CollapsibleContent> : null}
  </Collapsible>;
}

function ReliabilityPanel({ action, icon, title, description, score, children }: Readonly<{ action?: React.ReactNode; icon?: React.ReactNode; title: string; description?: string; score?: React.ReactNode; children?: React.ReactNode }>) {
  const { t } = useModuleTranslation('conversation');
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={conversationPanelClassName}>
      <div className='grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-1 md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]'>
        <span className='relative col-start-1 row-start-1 flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          <span className='absolute inset-1 rounded-full bg-primary/20 ring-1 ring-primary/40' />
          {icon || <ShieldCheck className='size-4 text-primary' />}
        </span>
        <div className='col-start-2 row-start-1 min-w-0'>
          <p className='text-sm font-medium text-foreground'>{title}</p>
          {description && <p className='text-xs leading-relaxed text-muted-foreground'>{description}</p>}
        </div>
        {action ? <div className='col-start-2 row-start-2 justify-self-start md:col-start-3 md:row-start-1'>{action}</div> : null}
        {score ? <div className='col-start-3 row-start-2 justify-self-end md:col-start-4 md:row-start-1'>{score}</div> : null}
        {children ? <CollapsibleTrigger className='col-start-3 row-start-1 inline-flex size-11 shrink-0 items-center justify-center justify-self-end rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:col-start-5 md:size-8 [&[data-state=open]>svg]:rotate-180' aria-label={open ? t('reliability.collapseAria') : t('reliability.expandAria')}>
          <ChevronDown className='size-4 transition-transform' aria-hidden='true' />
        </CollapsibleTrigger> : null}
      </div>
      {children ? <CollapsibleContent>{children}</CollapsibleContent> : null}
    </Collapsible>
  );
}
