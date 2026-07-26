import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageReliabilityCard } from './MessageReliabilityCard';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, options?: Record<string, number>) => {
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
        'correction.title': 'Answer correction',
        'correction.status.correcting': 'Correcting after verification',
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
    expect(screen.getByText('72/100')).toBeInTheDocument();
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

  it('encapsulates correction progress inside the reliability panel', () => {
    const onVersionChange = vi.fn();
    const { container } = render(<MessageReliabilityCard
      evaluation={completedEvaluation}
      correctionWorkflow={{
        mode: 'corrective_transparent', status: 'correcting', activeVersion: 'original',
        threshold: 70, attemptCount: 1, maxAttempts: 1,
        failureBehavior: 'publish_with_warning', showOriginalAnswer: true,
        queuedAt: '2026-07-26T00:00:00.000Z',
      }}
      displayedVersion='original'
      onVersionChange={onVersionChange}
    />);
    const correctionPane = screen.getByRole('status', { name: 'Answer correction' });
    expect(container.firstChild).toContainElement(correctionPane);
    expect(correctionPane).toHaveTextContent('Correcting after verification');
  });
});
