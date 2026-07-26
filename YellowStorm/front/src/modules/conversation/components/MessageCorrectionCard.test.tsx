import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageCorrectionCard } from './MessageCorrectionCard';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string, options?: { count?: number }) => `${key}${options?.count === undefined ? '' : `:${options.count}`}` }) }));

const workflow = {
  mode: 'corrective_transparent' as const,
  status: 'corrected' as const,
  activeVersion: 'corrected' as const,
  threshold: 70,
  attemptCount: 1,
  maxAttempts: 1,
  correctedComponents: [{ id: 'text-1', type: 'text' as const, data: { content: 'Corrected' } }],
  appliedCorrections: [{ claim: 'Claim', action: 'replaced' as const, explanation: 'Fixed' }],
  failureBehavior: 'publish_with_warning' as const,
  showOriginalAnswer: true,
  queuedAt: '2026-07-26T00:00:00.000Z',
};

describe('MessageCorrectionCard', () => {
  it('shows corrected state and lets users view the original', () => {
    const onVersionChange = vi.fn();
    render(<MessageCorrectionCard workflow={workflow} displayedVersion="corrected" onVersionChange={onVersionChange} />);
    expect(screen.getByRole('region', { name: 'correction.title' })).toBeInTheDocument();
    expect(screen.getByText('correction.status.corrected')).toBeInTheDocument();
    expect(screen.getByText('correction.correctedCount:1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'correction.viewOriginal' }));
    expect(onVersionChange).toHaveBeenCalledWith('original');
  });

  it('announces correction progress', () => {
    render(<MessageCorrectionCard workflow={{ ...workflow, status: 're_evaluating', activeVersion: 'original' }} displayedVersion="original" onVersionChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('correction.status.re_evaluating');
  });

  it.each([
    ['failed', 'correction.publishWarning'],
    ['abstained', 'correction.abstentionReason'],
    ['human_review_required', 'correction.status.human_review_required'],
  ] as const)('renders the %s terminal behavior', (status, copy) => {
    render(<MessageCorrectionCard workflow={{ ...workflow, status, activeVersion: status === 'abstained' ? 'abstention' : 'original' }} displayedVersion={status === 'abstained' ? 'abstention' : 'original'} onVersionChange={vi.fn()} />);
    expect(screen.getByText(copy)).toBeInTheDocument();
  });
});
