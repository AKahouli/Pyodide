import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreateTemplateModal } from './index';

const closeCreateTemplateModalMock = vi.fn();
const setCreateTemplateModalStepMock = vi.fn();

const modalState = {
  isCreateTemplateModalOpen: true,
  createTemplateModalStep: 1,
};

vi.mock('../../../store', () => ({
  useWorkspaceModalState: () => modalState,
  useWorkspaceStore: (selector: (s: { closeCreateTemplateModal: typeof closeCreateTemplateModalMock; setCreateTemplateModalStep: typeof setCreateTemplateModalStepMock; createSetting: (payload: unknown) => Promise<void> }) => unknown) =>
    selector({
      closeCreateTemplateModal: closeCreateTemplateModalMock,
      setCreateTemplateModalStep: setCreateTemplateModalStepMock,
      createSetting: vi.fn(async () => undefined),
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

vi.mock('./CreateTemplateModalHeader', () => ({
  CreateTemplateModalHeader: ({ currentStep }: { currentStep: number }) => <div>header-step-{currentStep}</div>,
}));

vi.mock('./CreateTemplateStep1', () => ({
  CreateTemplateStep1: ({ onNext }: { onNext: (data: { name: string }) => void }) => <button onClick={() => onNext({ name: 'T1' })}>step1-next</button>,
}));

vi.mock('./CreateTemplateStep2', () => ({
  CreateTemplateStep2: () => <div>step2-content</div>,
}));

describe('CreateTemplateModal', () => {
  it('renders step1 and moves to step2 when next is triggered', async () => {
    modalState.createTemplateModalStep = 1;
    render(<CreateTemplateModal />);

    expect(screen.getByText('header-step-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'step1-next' }));
    expect(setCreateTemplateModalStepMock).toHaveBeenCalledWith(2);
  });

  it('closes modal on dialog close', async () => {
    render(<CreateTemplateModal />);
    await userEvent.click(screen.getByRole('button', { name: 'close-modal' }));
    expect(closeCreateTemplateModalMock).toHaveBeenCalled();
  });
});
