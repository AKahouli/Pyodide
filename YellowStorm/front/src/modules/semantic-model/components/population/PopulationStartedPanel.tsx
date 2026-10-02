import { AlertTriangle, CheckCircle2, StopCircle, FileStack, Loader2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { ConceptSourceMapping, PopulationProgress } from '../../types';
import { RunProgress } from './RunProgress';

export interface PopulationOutcome {
  jobId: string;
  /** The runtime job's state — for a reused run this is the state of the EXISTING job. */
  status: string;
  skipped: Array<{ mappingId: string; reason: string }>;
  reused: boolean;
  /** Files the run reads (a workspace source counts each of its files). */
  sourceCount?: number;
  /** Last progress reported by the run, kept once it ends so the summary stays on screen. */
  progress?: Partial<PopulationProgress>;
  /** Whether the result replaced the graph in use, kept once the run ends (the job is no longer followed then). */
  serving?: PopulationServing;
}

type Tone = 'running' | 'stopping' | 'stopped' | 'done' | 'gaps' | 'failed';

/**
 * What happened when the reader was asked to read the sources.
 *
 * A request is idempotent: asking twice for the same model, sources and purpose returns the
 * previous job instead of starting a new one. That previous job may already have finished or
 * failed, so this panel reports the job's actual state. Claiming "reading…" for a run that
 * ended hours ago would leave someone waiting for records that are never coming.
 */
/** Whether the run's result replaced the graph in use, from the runtime's job result. */
export interface PopulationServing {
  decision: 'activate' | 'keep_previous';
  /** What the result is missing (source not read, a cap reached…); empty when complete. */
  blocking: string[];
}

export function populationServing(result: Record<string, unknown> | null | undefined): PopulationServing | undefined {
  const decision = result?.servingDecision;
  if (decision !== 'activate' && decision !== 'keep_previous') return undefined;
  const blocking = Array.isArray(result?.blockingGapKinds) ? result.blockingGapKinds.filter((kind): kind is string => typeof kind === 'string') : [];
  return { decision, blocking };
}

const KNOWN_BLOCKING = new Set(['source_unavailable', 'index_unavailable', 'index_ambiguous', 'enumeration_capped', 'materialization_cap', 'assertion_cap', 'relationship_cap', 'budget_exhausted']);

export function PopulationStartedPanel({ outcome, sourceMappings, progress, conceptLabels, onClose, onOpenHealth, onStop, stopping = false, serving }: Readonly<{
  outcome: PopulationOutcome;
  sourceMappings: ConceptSourceMapping[];
  /** Live progress of the run, when it reports some. */
  progress?: Partial<PopulationProgress>;
  conceptLabels?: Record<string, string>;
  onClose: () => void;
  onOpenHealth: () => void;
  /** Stop the run; nothing it read is kept. Absent when the person cannot stop it. */
  onStop?: () => void;
  stopping?: boolean;
  serving?: PopulationServing;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const names = new Map(sourceMappings.map((mapping) => [mapping.id, mapping.documentName] as const));
  const shownProgress = progress ?? outcome.progress;
  const readCount = shownProgress?.total || outcome.sourceCount || Math.max(0, sourceMappings.length - outcome.skipped.length);
  const tone = toneOf(outcome.status);

  const title = tone === 'stopped' ? t('runStop.stopped')
    : tone === 'stopping' ? t('runStop.stopping')
    : tone === 'failed' ? t('population.failed')
    : tone === 'gaps' ? t('population.finishedWithGaps')
    : tone === 'done' ? t(outcome.reused ? 'population.finished' : 'population.done')
    : outcome.reused ? t('population.alreadyRunning') : t('population.started');

  const detail = tone === 'stopped' ? t('runStop.stoppedHint')
    : tone === 'stopping' ? t('runStop.stoppingHint')
    : tone === 'failed' ? t('population.failedHint')
    : tone === 'gaps' ? t('population.gapsHint')
    : tone === 'done' ? t(outcome.reused ? 'population.finishedHint' : 'population.doneHint')
    : t('population.startedHint', { count: readCount });

  return <aside className='relative z-20 flex h-full w-full max-w-sm shrink-0 flex-col border-l bg-background shadow-xl'>
    <header className='flex items-start gap-3 border-b px-4 py-3'>
      {tone === 'running' || tone === 'stopping' ? <Loader2 className='mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary' />
        : tone === 'stopped' ? <StopCircle className='mt-0.5 h-5 w-5 shrink-0 text-muted-foreground' />
        : tone === 'failed' ? <XCircle className='mt-0.5 h-5 w-5 shrink-0 text-destructive' />
        : tone === 'gaps' ? <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400' />
        : <CheckCircle2 className='mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400' />}
      <div className='min-w-0 flex-1'>
        <h2 className='font-semibold'>{title}</h2>
        <p className='mt-1 text-xs text-muted-foreground'>{detail}</p>
      </div>
      <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={onClose} aria-label={t('action.close')}>
        <X className='h-4 w-4' />
      </Button>
    </header>

    <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-3 pb-28'>
      {tone === 'running' && onStop && <Button variant='outline' size='sm' className='w-full' disabled={stopping} onClick={onStop}>
        {stopping ? <Loader2 className='mr-1.5 h-4 w-4 animate-spin' /> : <StopCircle className='mr-1.5 h-4 w-4' />}
        {stopping ? t('runStop.stopping') : t('runStop.stop')}
      </Button>}
      {shownProgress && (shownProgress.total ?? 0) > 0 && <RunProgress progress={shownProgress} running={tone === 'running' || tone === 'stopping'} conceptLabels={conceptLabels} />}
      {/* A result missing data never replaces the graph in use; the first graph of a model is shown anyway. */}
      {serving && serving.blocking.length > 0 && tone !== 'running' && <section role='status' className='rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300'>
        <p className='font-semibold'>{t(serving.decision === 'keep_previous' ? 'runServing.kept' : 'runServing.firstIncomplete')}</p>
        <p className='mt-1'>{t(serving.decision === 'keep_previous' ? 'runServing.keptHint' : 'runServing.firstIncompleteHint')}</p>
        <ul className='mt-2 list-disc space-y-0.5 pl-4'>
          {serving.blocking.map((kind) => <li key={kind}>{t((KNOWN_BLOCKING.has(kind) ? `runServing.kind_${kind}` : 'runServing.kind_other') as 'runServing.kind_other')}</li>)}
        </ul>
      </section>}
      {/* A reused terminal job means this click changed nothing — say so rather than implying progress. */}
      {outcome.reused && tone !== 'running' && <p className='mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400'>
        {t('population.reusedNotice')}
      </p>}
      {outcome.skipped.length === 0
        ? <p className='flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
          <FileStack className='h-4 w-4 shrink-0' />{t('population.allSourcesIncluded')}
        </p>
        : <section>
          <h3 className='mb-2 flex items-center gap-2 text-sm font-semibold'>
            <AlertTriangle className='h-4 w-4 text-amber-600 dark:text-amber-400' />
            {t('population.skippedTitle', { count: outcome.skipped.length })}
          </h3>
          <ul className='space-y-1.5'>
            {outcome.skipped.map((item) => <li key={item.mappingId} className='rounded-lg border bg-muted/30 p-2.5'>
              <p className='truncate text-sm font-medium'>{names.get(item.mappingId) ?? t('population.unknownSource')}</p>
              <p className='mt-0.5 text-xs text-muted-foreground'>{item.reason}</p>
            </li>)}
          </ul>
        </section>}
    </div>

    <footer className='shrink-0 space-y-2 border-t px-4 py-3'>
      <p className='text-xs text-muted-foreground'>{t('population.resultsHint')}</p>
      <Button variant='outline' className='w-full' onClick={onOpenHealth}>{t('population.openHealth')}</Button>
    </footer>
  </aside>;
}

/** Runtime job states, mapped to what a business user needs to know. */
function toneOf(status: string): Tone {
  if (status === 'cancelled') return 'stopped';
  if (status === 'cancel_requested') return 'stopping';
  if (status === 'failed' || status === 'superseded') return 'failed';
  if (status === 'completed_with_gaps') return 'gaps';
  if (status === 'completed') return 'done';
  return 'running';
}
