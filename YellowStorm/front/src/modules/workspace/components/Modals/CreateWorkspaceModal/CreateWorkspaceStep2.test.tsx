import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateWorkspaceStep2 } from './CreateWorkspaceStep2';

vi.mock('../../../store', () => ({
  useWorkspaceLoading: () => ({ isCreating: false, isLoadingTemplates: false }),
  useWorkspaceStore: (selector: (s: { templates: Array<{ id: string; name: string; description?: string; isTemplate: true; isPredefined: boolean; createdBy: string; chunks: number; ragType: 'standard'; topK: number; maxToken: number; hybridSearch: boolean; createdAt: string; updatedAt: string }> }) => unknown) =>
    selector({
      templates: [
        {
          id: 'tpl-1',
          name: 'Template A',
          description: 'Template description',
          isTemplate: true,
          isPredefined: true,
          createdBy: 'u-1',
          chunks: 5,
          ragType: 'standard',
          topK: 10,
          maxToken: 4096,
          hybridSearch: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
    }),
}));

vi.mock('./TemplatePreview', () => ({
  TemplatePreview: () => <div>template-preview</div>,
}));

describe('CreateWorkspaceStep2', () => {
  it('submits default mode payload and supports going back', async () => {
    const onSubmit = vi.fn();
    const onBack = vi.fn();

    render(<CreateWorkspaceStep2 onBack={onBack} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: 'modal.createWorkspace.step2.actions.submit' }));
    expect(onSubmit).toHaveBeenCalledWith({ mode: 'default' });

    await userEvent.click(screen.getByRole('button', { name: 'modal.createWorkspace.step2.actions.back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
