import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HistoricalPreviewBanner, VersionSwitcher } from './VersionHistoryPanel';

const previewFinalizedVersion = vi.fn();
const deploy = vi.fn().mockResolvedValue(undefined);

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
      previewFinalizedVersion,
      deploy,
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

describe('VersionSwitcher', () => {
  it('renders a compact trigger with the active revision', () => {
    render(<VersionSwitcher />);

    expect(screen.getByRole('button', { name: 'versionHistory.open' })).toHaveTextContent('rev_7');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens the version list in a popover and allows preview', async () => {
    const user = userEvent.setup();
    render(<VersionSwitcher />);

    await user.click(screen.getByRole('button', { name: 'versionHistory.open' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('versionHistory.title')).toBeInTheDocument();
    expect(within(dialog).getByText('rev_12')).toBeInTheDocument();
    expect(within(dialog).getByText('rev_7')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'versionHistory.preview' }));
    expect(previewFinalizedVersion).toHaveBeenCalledWith('rev_12');
  });
});

describe('HistoricalPreviewBanner', () => {
  it('shows a slim banner while previewing a historical revision', () => {
    render(<HistoricalPreviewBanner />);

    expect(screen.getByText('versionHistory.previewBanner:rev_7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'versionHistory.returnToLatest' })).toBeInTheDocument();
  });
});
