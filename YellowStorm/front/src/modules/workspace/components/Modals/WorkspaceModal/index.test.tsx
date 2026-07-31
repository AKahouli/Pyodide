import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceModal } from './index';

const closeModalMock = vi.fn();

vi.mock('../../../store', () => ({
  useWorkspaceStore: (selector: (state: { isModalOpen: boolean; closeModal: () => void }) => unknown) =>
    selector({ isModalOpen: true, closeModal: closeModalMock }),
  useWorkspaceModalState: () => ({ isMobileSidebarOpen: false }),
}));

vi.mock('@/modules/file-viewer/store', () => ({
  useFileViewerMode: () => 'closed',
}));

vi.mock('./WorkspaceModalContent', () => ({
  WorkspaceModalContent: () => <div>workspace-modal-content</div>,
}));

describe('WorkspaceModal', () => {
  it('renders content and closes when dialog closes', async () => {
    render(<WorkspaceModal />);

    expect(screen.getByText('workspace-modal-content')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(closeModalMock).toHaveBeenCalled();
  });
});
