import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageReliabilityCard } from './MessageReliabilityCard';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const values: Record<string, string> = {
        'reliability.pendingTitle': 'Checking sources',
        'reliability.pendingDescription': 'Comparing the answer with its attached sources.',
        'reliability.notScored': 'Not enough source information',
        'reliability.insufficientEvidence': 'Not enough material.',
        'reliability.title': 'Answer reliability',
        'reliability.labels.mostly_supported': 'Mostly supported',
        'reliability.supportedCount': `${options?.supported} of ${options?.total} statements match the sources`,
        'reliability.claimsTrigger': `Claims (${options?.count})`,
        'reliability.claimsAria': `Review ${options?.count} reliability claims`,
        'reliability.summaries.conflicts': `Sources conflict with ${options?.count} statements.`,
        'reliability.summaries.missing': `Sources do not confirm ${options?.count} statements.`,
        'reliability.summaries.partialSupport': 'Some statements are partly confirmed.',
        'reliability.summaries.allSupported': 'All statements match.',
        'reliability.groups.contradicted': `Conflicts with sources (${options?.count})`,
        'reliability.groups.unsupported': `Not found in sources (${options?.count})`,
        'reliability.groups.partially_supported': `Partly supported (${options?.count})`,
        'reliability.groups.supported': `Supported by sources (${options?.count})`,
        'reliability.keyClaim': 'Key claim',
        'reliability.legacyFindings': 'Claims needing attention',
        'reliability.disclaimer': 'Source comparison disclaimer',
        'reliability.timelineTitle': 'Evaluation history',
        'reliability.originalEvaluation': 'Original evaluation',
        'reliability.unavailable': 'Reliability check unavailable',
        'reliability.unavailableDescription': 'The answer could not be checked.',
        'reliability.notRecorded': 'No reliability evaluation was recorded.',
        'correction.attemptLabel': `Correction attempt ${options?.count}`,
        'correction.title': 'Answer correction',
        'correction.status.correcting': 'Correcting after verification',
        'correction.status.re_evaluating': 'Verifying the corrected answer',
        'correction.status.corrected': 'Corrected after verification',
        'correction.status.failed': 'Correction incomplete',
        'correction.status.abstained': 'Answer withheld after verification',
        'correction.status.human_review_required': 'Awaiting human review',
        'correction.publishWarning': 'Review each attempt.',
        'correction.abstentionReason': 'The available evidence was insufficient or conflicting.',
        'correction.attemptStatus.failed': 'Failed',
        'correction.attemptStatus.rejected': 'Not published',
        'correction.viewOriginal': 'View original',
        'correction.viewCorrected': 'View corrected',
        'correction.viewAbstention': 'View verification result',
        'correction.viewAttempt': `View attempt ${options?.count}`,
        'correction.strategy.correctiveReplay': 'Answer regenerated after verification',
        'correction.strategy.correctiveReplayDetail': 'The original request was rerun.',
        'correction.uncertainties': `${options?.count} remaining uncertainties`,
        'correction.reason.candidate_evaluation_failed': 'The generated answer could not be evaluated.',
        'correction.reason.score_below_threshold': `Score ${options?.score}/100 is below the required ${options?.threshold}/100.`,
        'correction.failureCode': `Diagnostic: ${options?.code}`,
      };
      return values[key] || key;
    },
  }),
}));

const completedEvaluation = {
  status: 'completed' as const,
  score: 72,
  label: 'mostly_supported' as const,
  claimCounts: { total: 4, supported: 1, partiallySupported: 1, unsupported: 1, contradicted: 1 },
  claims: [
    { claim: 'Supported claim', status: 'supported' as const, importance: 'minor' as const, explanation: 'The source confirms this.' },
    { claim: 'Partial claim', status: 'partially_supported' as const, importance: 'major' as const, explanation: 'Only part is confirmed.' },
    { claim: 'Missing claim', status: 'unsupported' as const, importance: 'critical' as const, explanation: 'The source does not mention this.' },
    { claim: 'Conflicting claim', status: 'contradicted' as const, importance: 'major' as const, explanation: 'The source gives a different value.' },
  ],
  findings: [{ claim: 'Missing claim', status: 'unsupported' as const, importance: 'critical' as const, explanation: 'The source does not mention this.' }],
  evaluator: { modelId: 'secret-id', modelName: 'judge-name', evaluatorVersion: 'v1', promptVersion: 'p1' },
};

describe('MessageReliabilityCard', () => {
  it('renders nothing without evaluation metadata', () => {
    const { container } = render(<MessageReliabilityCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('aligns pending and non-scored states with the activity panel shell', () => {
    const { container, rerender } = render(<MessageReliabilityCard evaluation={{ status: 'pending' }} />);
    expect(screen.getByText('Checking sources')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('mx-2', 'md:mx-4', 'rounded-xl');
    rerender(<MessageReliabilityCard evaluation={{ status: 'insufficient_evidence' }} />);
    expect(screen.getByText('Not enough source information')).toBeInTheDocument();
    expect(screen.queryByText(/0\/100/)).not.toBeInTheDocument();
  });

  it('groups every claim and opens attention groups by default', () => {
    const { container } = render(<MessageReliabilityCard evaluation={completedEvaluation} />);
    expect(container.firstChild).toHaveClass('mx-2', 'md:mx-4', 'rounded-xl');
    expect(screen.getByText('72/100')).toHaveClass('rounded-md');
    const outerTrigger = screen.getByRole('button', { name: 'Review 4 reliability claims' });
    expect(outerTrigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(outerTrigger);

    expect(screen.getByRole('button', { name: 'Conflicts with sources (1)' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Not found in sources (1)' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Partly supported (1)' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Supported by sources (1)' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('Missing claim')).toHaveLength(1);
    expect(screen.getByText('Key claim')).toBeInTheDocument();
    expect(screen.queryByText('judge-name')).not.toBeInTheDocument();
  });

  it('keeps historical evaluations without complete claims readable', () => {
    render(<MessageReliabilityCard evaluation={{
      ...completedEvaluation,
      claims: undefined,
      claimCounts: { total: 2, supported: 1, partiallySupported: 0, unsupported: 1, contradicted: 0 },
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review 2 reliability claims' }));
    expect(screen.getByText('Claims needing attention')).toBeInTheDocument();
    expect(screen.getByText('The source does not mention this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supported by sources (1)' })).not.toBeInTheDocument();
  });

  it('removes the separate correction pane and keeps version controls in evaluation history', () => {
    const onVersionChange = vi.fn();
    render(<MessageReliabilityCard
      evaluation={completedEvaluation}
      originalEvaluation={completedEvaluation}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'correcting', activeVersion: 'original',
        threshold: 70, attemptCount: 1, maxAttempts: 1,
        failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T00:00:00.000Z',
      }}
      displayedVersion='original'
      onVersionChange={onVersionChange}
    />);
    expect(screen.queryByText('Answer correction')).not.toBeInTheDocument();
    expect(screen.getByText('Evaluation history')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View original' })).toBeDisabled();
  });

  it('renders timestamped original and attempt evaluation occurrences', () => {
    const onVersionChange = vi.fn();
    render(<MessageReliabilityCard
      evaluation={{ ...completedEvaluation, score: 52, evaluatedAt: '2026-07-26T10:01:00.000Z' }}
      originalEvaluation={{ ...completedEvaluation, score: 30, evaluatedAt: '2026-07-26T10:00:00.000Z' }}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'failed', activeVersion: 'original', threshold: 70,
        attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T10:00:00.000Z', attempts: [{
          attemptId: 'attempt-1', attemptNumber: 1, status: 'rejected', decision: 'rejected',
          policyReasons: ['score_below_threshold'], createdAt: '2026-07-26T10:00:30.000Z',
          components: [{ id: 'candidate', type: 'text', data: { content: 'Candidate' } }],
          evaluation: { ...completedEvaluation, score: 52, evaluatedAt: '2026-07-26T10:01:00.000Z' },
        }],
      }}
      displayedVersion='attempt:attempt-1'
      onVersionChange={onVersionChange}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Review 4 reliability claims' }));
    expect(screen.getByText('Evaluation history')).toBeInTheDocument();
    expect(screen.getByText('Original evaluation')).toBeInTheDocument();
    expect(screen.getByText('Correction attempt 1')).toBeInTheDocument();
    expect(screen.getAllByText('52/100').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'View attempt 1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'View original' }));
    expect(onVersionChange).toHaveBeenCalledWith('original');
  });

  it('keeps correction controls and all history visible for a failed selected attempt', () => {
    const onVersionChange = vi.fn();
    render(<MessageReliabilityCard
      evaluation={{ status: 'failed', failureCode: 'candidate_evaluation_unavailable' }}
      originalEvaluation={{ ...completedEvaluation, score: 45, evaluatedAt: '2026-07-26T10:00:00.000Z' }}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'failed', activeVersion: 'original', threshold: 70,
        attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T10:00:00.000Z', attempts: [{
          attemptId: 'attempt-1', attemptNumber: 1, status: 'failed', decision: 'failed',
          policyReasons: ['candidate_evaluation_failed'], failureCode: 'candidate_evaluation_unavailable',
          createdAt: '2026-07-26T10:00:30.000Z', completedAt: '2026-07-26T10:01:00.000Z',
          components: [{ id: 'candidate', type: 'text', data: { content: 'Candidate' } }],
          evaluation: { status: 'failed', failureCode: 'candidate_evaluation_unavailable', evaluatedAt: '2026-07-26T10:01:00.000Z' },
        }],
      }}
      displayedVersion='attempt:attempt-1'
      onVersionChange={onVersionChange}
    />);

    expect(screen.getByText('Reliability check unavailable')).toBeInTheDocument();
    expect(screen.getByText('Evaluation history')).toBeInTheDocument();
    expect(screen.getByText('Original evaluation')).toBeInTheDocument();
    expect(screen.getByText('Review each attempt.')).toBeInTheDocument();
    expect(screen.getByText('The generated answer could not be evaluated.')).toBeInTheDocument();
    expect(screen.getByText('Diagnostic: candidate_evaluation_unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View original' }));
    expect(onVersionChange).toHaveBeenCalledWith('original');
  });

  it('keeps an unavailable attempt view button visible but disabled', () => {
    render(<MessageReliabilityCard
      evaluation={completedEvaluation}
      originalEvaluation={completedEvaluation}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'failed', activeVersion: 'original', threshold: 70,
        attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T10:00:00.000Z', attempts: [{
          attemptId: 'attempt-1', attemptNumber: 1, status: 'failed', decision: 'failed',
          policyReasons: ['candidate_evaluation_failed'], createdAt: '2026-07-26T10:00:30.000Z',
        }],
      }}
      displayedVersion='original'
      onVersionChange={vi.fn()}
    />);

    expect(screen.getByRole('button', { name: 'View original' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View attempt 1' })).toBeDisabled();
  });

  it('keeps legacy corrected and abstention versions reachable from history', () => {
    const onVersionChange = vi.fn();
    const { rerender } = render(<MessageReliabilityCard
      evaluation={completedEvaluation}
      originalEvaluation={completedEvaluation}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'corrected', activeVersion: 'corrected', strategy: 'corrective_replay',
        threshold: 70, attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T10:00:00.000Z', completedAt: '2026-07-26T10:01:00.000Z',
        correctedComponents: [{ id: 'corrected', type: 'text', data: { content: 'Corrected' } }],
        finalReliabilityEvaluation: { ...completedEvaluation, score: 88 },
      }}
      displayedVersion='original'
      onVersionChange={onVersionChange}
    />);

    expect(screen.getByText('Answer regenerated after verification')).toBeInTheDocument();
    expect(screen.getByText('88/100')).toHaveClass('rounded-md');
    fireEvent.click(screen.getByRole('button', { name: 'View corrected' }));
    expect(onVersionChange).toHaveBeenCalledWith('corrected');

    rerender(<MessageReliabilityCard
      evaluation={completedEvaluation}
      originalEvaluation={completedEvaluation}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'abstained', activeVersion: 'abstention', threshold: 70,
        attemptCount: 1, maxAttempts: 1, failureBehavior: 'abstain', showOriginalAnswer: true,
        queuedAt: '2026-07-26T10:00:00.000Z', completedAt: '2026-07-26T10:01:00.000Z',
      }}
      displayedVersion='original'
      onVersionChange={onVersionChange}
    />);

    expect(screen.getByText('The available evidence was insufficient or conflicting.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View verification result' }));
    expect(onVersionChange).toHaveBeenCalledWith('abstention');
  });

  it('announces active correction progress and preserves human-review status', () => {
    const workflow = {
      mode: 'corrective_transparent' as const, activeVersion: 'original' as const, threshold: 70,
      attemptCount: 1, maxAttempts: 1, failureBehavior: 'require_human_review' as const, showOriginalAnswer: true,
      queuedAt: '2026-07-26T10:00:00.000Z',
    };
    const { rerender } = render(<MessageReliabilityCard
      evaluation={completedEvaluation}
      originalEvaluation={completedEvaluation}
      correctionWorkflow={{ ...workflow, status: 're_evaluating' }}
    />);
    expect(screen.getByRole('status')).toHaveTextContent('Verifying the corrected answer');

    rerender(<MessageReliabilityCard
      evaluation={completedEvaluation}
      originalEvaluation={completedEvaluation}
      correctionWorkflow={{ ...workflow, status: 'human_review_required' }}
    />);
    expect(screen.getByText('Awaiting human review')).toBeInTheDocument();
  });
});
