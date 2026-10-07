import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppTemplate } from '../../types';
import { TemplateCard } from './TemplateCard';

const template = {
  id: 'tpl-1',
  categoryId: 'cat-1',
  categoryName: 'Business',
  title: 'CRM starter',
  description: 'A starter CRM',
  coverImage: '',
  status: 'published',
  revisionId: 'template_tpl-1',
  platformReport: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
} as AppTemplate;

describe('TemplateCard', () => {
  it('hides admin edit/delete for non-admins', () => {
    render(<TemplateCard template={template} onOpen={vi.fn()} onClone={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'admin.editTemplate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'admin.deleteTemplate' })).not.toBeInTheDocument();
  });

  it('exposes admin edit/delete that call the parent handlers', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onOpen = vi.fn();

    render(
      <TemplateCard
        template={template}
        onOpen={onOpen}
        onClone={vi.fn()}
        isSuperAdmin
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'admin.editTemplate' }));
    expect(onEdit).toHaveBeenCalledWith(template);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'admin.deleteTemplate' }));
    expect(onDelete).toHaveBeenCalledWith(template);
  });

  it('renders a cover image on the card', () => {
    render(
      <TemplateCard
        template={{ ...template, coverImage: 'https://cdn.test/crm.png' }}
        onOpen={vi.fn()}
        onClone={vi.fn()}
      />,
    );

    const img = document.querySelector('img[src="https://cdn.test/crm.png"]');
    expect(img).toHaveClass('object-cover');
  });
});
