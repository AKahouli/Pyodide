import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TemplatePreview } from './TemplatePreview';

describe('TemplatePreview', () => {
  it('expands and shows template details', async () => {
    render(
      <TemplatePreview
        template={{
          id: 't1',
          name: 'Template 1',
          instruction: 'Follow policy',
          isTemplate: true,
          isPredefined: false,
          createdBy: 'u1',
          chunks: 4,
          ragType: 'advancedRag',
          topK: 5,
          maxToken: 1000,
          hybridSearch: true,
          createdAt: '',
          updatedAt: '',
        }}
        ragTypeOptions={[{ value: 'advancedRag', label: 'Advanced RAG', description: '' }]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'modal.createWorkspace.step2.preview.button' }));
    expect(screen.getByText('modal.createWorkspace.step2.preview.instruction')).toBeInTheDocument();
    expect(screen.getByText('Follow policy')).toBeInTheDocument();
  });
});
