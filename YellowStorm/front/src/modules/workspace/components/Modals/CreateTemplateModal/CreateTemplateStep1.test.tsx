import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateTemplateStep1 } from './CreateTemplateStep1';

const closeCreateTemplateModalMock = vi.fn();

vi.mock('../../../store', () => ({
  useWorkspaceStore: (selector: (s: { closeCreateTemplateModal: typeof closeCreateTemplateModalMock }) => unknown) => selector({ closeCreateTemplateModal: closeCreateTemplateModalMock }),
}));

describe('CreateTemplateStep1', () => {
  it('submits step1 values and supports cancel', async () => {
    const onNext = vi.fn();
    render(<CreateTemplateStep1 onNext={onNext} />);

    await userEvent.type(screen.getByLabelText('modal.createTemplate.step1.nameLabel'), 'Template A');
    await userEvent.click(screen.getByRole('button', { name: 'modal.createTemplate.step1.next' }));

    await waitFor(() => {
      expect(onNext).toHaveBeenCalledWith({
        name: 'Template A',
        description: '',
        tag: '',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'modal.createTemplate.step1.cancel' }));
    expect(closeCreateTemplateModalMock).toHaveBeenCalledTimes(1);
  });
});
