import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { AppTemplate, TemplateCategory } from '../../types';

vi.mock('../../api', () => ({
  adminTemplateApi: {
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    validate: vi.fn(),
  },
}));

vi.mock('./validation/TemplateValidationPanel', () => ({
  TemplateValidationPanel: ({ templateId }: { templateId: string }) => (
    <div data-testid='validation-panel'>{templateId}</div>
  ),
}));

import { TemplateFormDialog } from './TemplateFormDialog';

const categories = [{ id: 'cat_1', name: 'Starters' } as TemplateCategory];

const template = (status: AppTemplate['status']): AppTemplate =>
  ({
    id: 'tpl_1',
    categoryId: 'cat_1',
    categoryName: 'Starters',
    title: 'Horizon',
    description: '',
    coverImage: '',
    status,
    revisionId: 'template_tpl_1',
    createdAt: '2026-09-28T07:16:40.796Z',
    updatedAt: '2026-09-28T07:16:40.796Z',
  }) as AppTemplate;

function renderDialog(current: AppTemplate | null) {
  return render(
    <TemplateFormDialog
      open
      onOpenChange={vi.fn()}
      template={current}
      categories={categories}
      onSaved={vi.fn()}
    />,
  );
}

describe('TemplateFormDialog draft validation', () => {
  it('lets a draft template run NodePod validation after a failed upload round trip', async () => {
    renderDialog(template('draft'));

    await userEvent.click(screen.getByRole('button', { name: 'templates.validateDraft' }));

    expect(screen.getByTestId('validation-panel')).toHaveTextContent('tpl_1');
  });

  it('does not offer validation for an already published template', () => {
    renderDialog(template('published'));

    expect(
      screen.queryByRole('button', { name: 'templates.validateDraft' }),
    ).not.toBeInTheDocument();
  });
});
