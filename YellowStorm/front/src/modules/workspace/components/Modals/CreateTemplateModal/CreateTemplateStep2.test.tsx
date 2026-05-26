import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTemplateStep2 } from './CreateTemplateStep2';

const fetchTemplatesMock = vi.fn();

vi.mock('../../../store', () => ({
  useWorkspaceLoading: () => ({ isCreating: false, isLoadingTemplates: false }),
  useWorkspaceStore: (selector: (s: { templates: Array<{ id: string; name: string; isTemplate: true; isPredefined: boolean; createdBy: string; chunks: number; ragType: 'standard'; topK: number; maxToken: number; hybridSearch: boolean; createdAt: string; updatedAt: string }>; fetchTemplates: typeof fetchTemplatesMock }) => unknown) =>
    selector({
      templates: [
        {
          id: 'tpl-1',
          name: 'Template 1',
          isTemplate: true,
          isPredefined: false,
          createdBy: 'u-1',
          chunks: 5,
          ragType: 'standard',
          topK: 10,
          maxToken: 32000,
          hybridSearch: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
      fetchTemplates: fetchTemplatesMock,
    }),
}));

describe('CreateTemplateStep2', () => {
  beforeEach(() => {
    fetchTemplatesMock.mockReset();
  });

  it('fetches templates on mount and submits defaults', async () => {
    const onSubmit = vi.fn();
    render(<CreateTemplateStep2 onBack={vi.fn()} onSubmit={onSubmit} />);

    expect(fetchTemplatesMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'modal.createTemplate.step2.actions.submit' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          chunks: 5,
          ragType: 'standard',
          maxToken: 32000,
          topK: 10,
        }),
      );
    });
  });
});
