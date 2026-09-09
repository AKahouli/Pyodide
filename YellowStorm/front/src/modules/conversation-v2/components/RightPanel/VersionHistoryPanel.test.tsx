import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionSwitcher } from './VersionHistoryPanel';

const previewFinalizedVersion = vi.fn();
const deploy = vi.fn().mockResolvedValue(undefined);

/** Mutable store snapshot — individual tests flip streaming/app state on it. */
const storeState: Record<string, unknown> = {};

vi.mock('../../store', () => ({
  useConversationV2Store: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(storeState),
}));

vi.mock('../../translation', () => ({
  useConversationV2Translation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.number != null ? `${key}:${String(params.number)}` : key,
    language: 'en',
  }),
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

const TURN_START_SECONDS = Math.floor(Date.parse('2026-09-03T10:00:00.000Z') / 1000);

const baseState = () => ({
  finalizedVersions: [
    { revisionId: 'rev_12', title: 'Latest', finalizedAt: '2026-09-02T10:00:00.000Z' },
    { revisionId: 'rev_7', title: 'Older', finalizedAt: '2026-09-01T10:00:00.000Z' },
  ],
  previewRevisionId: 'rev_7',
  loadingFinalizedVersions: false,
  previewFinalizedVersion,
  deploy,
  deployStatus: 'idle',
  streaming: false,
  events: [
    {
      type: 'message',
      event_id: 'u1',
      timestamp: TURN_START_SECONDS,
      role: 'user',
      content: 'go',
      attachments: [],
    },
  ],
  applicationComponent: undefined,
  appBuildProgress: null,
});

describe('VersionSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(storeState).forEach((key) => delete storeState[key]);
    Object.assign(storeState, baseState());
  });

  it('renders a compact trigger with the active version number', () => {
    render(<VersionSwitcher />);

    expect(screen.getByRole('button', { name: 'versionHistory.open' })).toHaveTextContent(
      'versionHistory.version:1',
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens the version list with numbered entries and previews by revisionId', async () => {
    const user = userEvent.setup();
    render(<VersionSwitcher />);

    await user.click(screen.getByRole('button', { name: 'versionHistory.open' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('versionHistory.title')).toBeInTheDocument();
    expect(within(dialog).getByText('versionHistory.version:2')).toBeInTheDocument();
    expect(within(dialog).getByText('versionHistory.version:1')).toBeInTheDocument();

    await user.click(within(dialog).getByText('versionHistory.version:2'));
    expect(previewFinalizedVersion).toHaveBeenCalledWith('rev_12');
  });

  it('shows the upcoming version as a draft row labelled "Version N" while streaming', () => {
    Object.assign(storeState, {
      streaming: true,
      applicationComponent: { workspaceRevisionId: 'rev_8' },
    });
    render(<VersionSwitcher />);

    // The history auto-opens when the draft appears — no click needed.
    const dialog = screen.getByRole('dialog');
    const draft = within(dialog).getByTestId('version-draft-row');
    // 2 finalized versions exist, so the in-progress one is the next number.
    expect(draft).toHaveTextContent('versionHistory.version:3');
    expect(draft).toHaveTextContent('versionHistory.draft');
    expect(draft).not.toHaveTextContent('rev_8');
  });

  it('auto-opens on draft start and closes once the version is recorded', () => {
    Object.assign(storeState, {
      streaming: true,
      applicationComponent: { workspaceRevisionId: 'rev_8' },
    });
    const { rerender } = render(<VersionSwitcher />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Finalizer step lands: the draft converts to a definitive version and the
    // history closes back.
    Object.assign(storeState, {
      applicationComponent: { workspaceRevisionId: 'rev_15' },
      finalizedVersions: [
        {
          revisionId: 'rev_15',
          title: 'Latest',
          finalizedAt: '2026-09-03T12:00:00.000Z',
        },
        { revisionId: 'rev_12', title: 'Older', finalizedAt: '2026-09-02T10:00:00.000Z' },
      ],
    });
    rerender(<VersionSwitcher />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('drops the draft status once the finalizer step records the version', async () => {
    Object.assign(storeState, {
      streaming: true,
      applicationComponent: { workspaceRevisionId: 'rev_15' },
      finalizedVersions: [
        {
          revisionId: 'rev_15',
          title: 'Latest',
          finalizedAt: '2026-09-03T12:00:00.000Z',
        },
        { revisionId: 'rev_12', title: 'Older', finalizedAt: '2026-09-02T10:00:00.000Z' },
      ],
    });
    const user = userEvent.setup();
    render(<VersionSwitcher />);

    await user.click(screen.getByRole('button', { name: 'versionHistory.open' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByTestId('version-draft-row')).not.toBeInTheDocument();
    expect(within(dialog).getByText('versionHistory.version:2')).toBeInTheDocument();
    expect(within(dialog).queryByText('versionHistory.draft')).not.toBeInTheDocument();
  });

  it('appears during the very first build before any version exists', () => {
    Object.assign(storeState, {
      streaming: true,
      appBuildProgress: { phase: 'creating_files', message: 'Creating files', revision: 'p1' },
      finalizedVersions: [],
    });

    render(<VersionSwitcher />);

    expect(screen.getByRole('button', { name: 'versionHistory.open' })).toBeInTheDocument();
  });
});
