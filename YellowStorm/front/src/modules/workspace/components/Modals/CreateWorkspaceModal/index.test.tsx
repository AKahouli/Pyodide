import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreateWorkspaceModal } from './index';

const closeCreateModalMock = vi.fn();
const setCreateModalStepMock = vi.fn();

const modalState = {
  isCreateModalOpen: true,
  createModalStep: 1,
};

vi.mock('../../../store', () => ({
  useWorkspaceModalState: () => modalState,
  useWorkspaceStore: (selector: (s: { closeCreateModal: typeof closeCreateModalMock; setCreateModalStep: typeof setCreateModalStepMock; createWorkspace: (payload: unknown) => Promise<void>; createSetting: (payload: unknown) => Promise<{ id: string }> }) => unknown) =>
    selector({
      closeCreateModal: closeCreateModalMock,
      setCreateModalStep: setCreateModalStepMock,
      createWorkspace: vi.fn(async () => undefined),
      createSetting: vi.fn(async () => ({ id: 's-1' })),
    }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => (
    <div>
      <button onClick={() => onOpenChange?.(false)}>close-modal</button>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./CreateWorkspaceModalHeader', () => ({
  CreateWorkspaceModalHeader: ({ currentStep }: { currentStep: number }) => <div>header-step-{currentStep}</div>,
}));

vi.mock('./CreateWorkspaceStep1', () => ({
  CreateWorkspaceStep1: ({ onNext }: { onNext: (data: { name: string }) => void }) => <button onClick={() => onNext({ name: 'Workspace A' })}>step1-next</button>,
}));

vi.mock('./CreateWorkspaceStep2', () => ({
  CreateWorkspaceStep2: () => <div>step2-content</div>,
}));

describe('CreateWorkspaceModal', () => {
  it('renders step1 and advances on next', async () => {
    modalState.createModalStep = 1;
    render(<CreateWorkspaceModal />);

    expect(screen.getByText('header-step-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'step1-next' }));
    expect(setCreateModalStepMock).toHaveBeenCalledWith(2);
  });

  it('closes modal when dialog closes', async () => {
    render(<CreateWorkspaceModal />);
    await userEvent.click(screen.getByRole('button', { name: 'close-modal' }));
    expect(closeCreateModalMock).toHaveBeenCalled();
  });
});
