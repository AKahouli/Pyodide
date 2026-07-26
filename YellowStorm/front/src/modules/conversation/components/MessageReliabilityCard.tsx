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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ActiveAnswerVersion, ReliabilityClaimStatus, ReliabilityEvaluation, ReliabilityFinding, ResponseCorrectionWorkflow } from '../types';
import { MessageCorrectionCard } from './MessageCorrectionCard';

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
  correctionWorkflow?: ResponseCorrectionWorkflow;
  displayedVersion?: ActiveAnswerVersion;
  onVersionChange?: (version: ActiveAnswerVersion) => void;
}

export function MessageReliabilityCard({ evaluation, correctionWorkflow, displayedVersion = 'original', onVersionChange }: Readonly<MessageReliabilityCardProps>) {
  const { t } = useModuleTranslation('conversation');
  const [open, setOpen] = useState(false);
  if (!evaluation) return null;

  if (evaluation.status === 'pending') {
    return (
      <ReliabilityPanelHeader
        icon={<Loader2 className='size-5 animate-spin text-primary [animation-duration:1.1s]' />}
        title={t('reliability.pendingTitle')}
        description={t('reliability.pendingDescription')}
      >
        <CorrectionPane workflow={correctionWorkflow} displayedVersion={displayedVersion} onVersionChange={onVersionChange} />
      </ReliabilityPanelHeader>
    );
  }
  if (evaluation.status === 'insufficient_evidence') {
    return <ReliabilityPanelHeader title={t('reliability.notScored')} description={t('reliability.insufficientEvidence')}><CorrectionPane workflow={correctionWorkflow} displayedVersion={displayedVersion} onVersionChange={onVersionChange} /></ReliabilityPanelHeader>;
  }
  if (evaluation.status === 'not_applicable') {
    return <ReliabilityPanelHeader title={t('reliability.notApplicable')} description={t('reliability.noClaims')}><CorrectionPane workflow={correctionWorkflow} displayedVersion={displayedVersion} onVersionChange={onVersionChange} /></ReliabilityPanelHeader>;
  }
  if (evaluation.status === 'failed') {
    return <ReliabilityPanelHeader icon={<AlertTriangle className='size-4 text-muted-foreground' />} title={t('reliability.unavailable')} description={t('reliability.unavailableDescription')}><CorrectionPane workflow={correctionWorkflow} displayedVersion={displayedVersion} onVersionChange={onVersionChange} /></ReliabilityPanelHeader>;
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
        <span className='shrink-0 text-sm font-semibold tabular-nums text-foreground'>{evaluation.score}/100</span>
        <CollapsibleTrigger className='inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted' aria-label={t('reliability.claimsAria', { count: counts.total })}>
          {t('reliability.claimsTrigger', { count: counts.total })}
          <ChevronDown className='size-3.5 transition-transform data-[state=open]:rotate-180' />
        </CollapsibleTrigger>
      </div>

      <CorrectionPane workflow={correctionWorkflow} displayedVersion={displayedVersion} onVersionChange={onVersionChange} />

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

function CorrectionPane({ workflow, displayedVersion, onVersionChange }: Readonly<{
  workflow?: ResponseCorrectionWorkflow;
  displayedVersion: ActiveAnswerVersion;
  onVersionChange?: (version: ActiveAnswerVersion) => void;
}>) {
  if (!workflow || !onVersionChange) return null;
  return <MessageCorrectionCard workflow={workflow} displayedVersion={displayedVersion} onVersionChange={onVersionChange} />;
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
        {children}
      </div>
    </div>
  );
}
