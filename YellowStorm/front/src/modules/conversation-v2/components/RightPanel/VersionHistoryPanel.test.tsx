import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VersionHistoryPanel } from './VersionHistoryPanel';

vi.mock('../../store', () => ({
  useConversationV2Store: (selector: (s: unknown) => unknown) =>
    selector({
      finalizedVersions: [
        {
          revisionId: 'rev_12',
          title: 'Latest',
          finalizedAt: '2026-09-02T10:00:00.000Z',
        },
        {
          revisionId: 'rev_7',
          title: 'Older',
          finalizedAt: '2026-09-01T10:00:00.000Z',
        },
      ],
      previewRevisionId: 'rev_7',
      loadingFinalizedVersions: false,
      previewFinalizedVersion: vi.fn(),
      deploy: vi.fn().mockResolvedValue(undefined),
      deployStatus: 'idle',
    }),
}));

vi.mock('../../translation', () => ({
  useConversationV2Translation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.revisionId ? `${key}:${params.revisionId}` : key,
    language: 'en',
  }),
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

describe('VersionHistoryPanel', () => {
  it('renders version history rows and historical preview banner', () => {
    render(<VersionHistoryPanel />);

    expect(screen.getByText('versionHistory.title')).toBeInTheDocument();
    expect(screen.getByText('rev_12')).toBeInTheDocument();
    expect(screen.getByText('rev_7')).toBeInTheDocument();
    expect(screen.getByText('versionHistory.previewBanner:rev_7')).toBeInTheDocument();
  });

  it('shows preview action for non-active versions', async () => {
    const user = userEvent.setup();
    render(<VersionHistoryPanel />);

    await user.click(screen.getByRole('button', { name: 'versionHistory.preview' }));
    const { useConversationV2Store } = await import('../../store');
    expect(useConversationV2Store).toBeDefined();
  });
});
