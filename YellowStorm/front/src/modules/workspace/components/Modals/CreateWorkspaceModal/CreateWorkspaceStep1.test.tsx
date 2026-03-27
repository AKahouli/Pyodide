import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateWorkspaceStep1 } from './CreateWorkspaceStep1';

const closeCreateModalMock = vi.fn();

vi.mock('../../../store', () => ({
  useWorkspaceStore: (selector: (state: { closeCreateModal: () => void }) => unknown) => selector({ closeCreateModal: closeCreateModalMock }),
}));

describe('CreateWorkspaceStep1', () => {
  it('submits step data to onNext', async () => {
    const onNext = vi.fn();

    render(<CreateWorkspaceStep1 onNext={onNext} />);

    await userEvent.type(screen.getByLabelText('modal.createWorkspace.step1.nameLabel'), 'Workspace X');
    await userEvent.type(screen.getByLabelText('modal.createWorkspace.step1.descriptionLabel'), 'Description X');
    await userEvent.type(screen.getByLabelText('modal.createWorkspace.step1.tagLabel'), 'tag-x');
    await userEvent.click(screen.getByRole('button', { name: 'modal.createWorkspace.step1.next' }));

    await waitFor(() =>
      expect(onNext).toHaveBeenCalledWith({
        name: 'Workspace X',
        description: 'Description X',
        tag: 'tag-x',
      }),
    );
  }, 15000);
});
