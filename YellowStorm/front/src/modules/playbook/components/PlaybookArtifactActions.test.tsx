import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookArtifactActions } from './PlaybookArtifactActions';

const mocks = vi.hoisted(() => ({
  requestAccess: vi.fn(),
  openViewer: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../api', () => ({ requestPlaybookArtifactAccess: mocks.requestAccess }));
vi.mock('@/modules/file-viewer', () => ({ openFileViewerFromUrl: mocks.openViewer }));
vi.mock('@/lib/notifications', () => ({ showError: mocks.showError }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => ({ 'artifacts.view': 'View', 'artifacts.download': 'Download', 'artifacts.generated': 'Generated file', 'artifacts.openError': 'Unable to open' }[key] || key) }) }));

describe('PlaybookArtifactActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestAccess.mockImplementation(async (_executionId, _artifactId, action) => ({
      url: `http://localhost:3000/api/v1/executions/artifacts/content?token=${action}-token`,
      expiresAt: '2026-08-24T13:10:00.000Z',
    }));
  });

  it('requests fresh scoped URLs for View and Download', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<PlaybookArtifactActions executionId="execution-1" artifactId="opaque-1" filename="report.pdf" mimeType="application/pdf" />);

    fireEvent.click(screen.getByRole('button', { name: 'View report.pdf' }));
    await waitFor(() => expect(mocks.openViewer).toHaveBeenCalledWith(expect.stringContaining('view-token'), 'report.pdf', 'application/pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Download report.pdf' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(mocks.requestAccess).toHaveBeenCalledTimes(2);
    expect(mocks.requestAccess).toHaveBeenNthCalledWith(1, 'execution-1', 'opaque-1', 'view');
    expect(mocks.requestAccess).toHaveBeenNthCalledWith(2, 'execution-1', 'opaque-1', 'download');
    anchorClick.mockRestore();
  });
});
