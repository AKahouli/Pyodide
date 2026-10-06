import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TemplateCategory } from '../../types';

const createCategoryMock = vi.hoisted(() => vi.fn(async () => ({})));
const updateCategoryMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../api', () => ({
  adminTemplateApi: {
    createCategory: createCategoryMock,
    updateCategory: updateCategoryMock,
  },
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { CategoryFormDialog } from './CategoryFormDialog';

const existing = {
  id: 'cat_1',
  name: 'Starters',
  slug: 'starters',
  icon: 'star',
} as TemplateCategory;

describe('CategoryFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a category with the picked icon', async () => {
    const onSaved = vi.fn();
    render(<CategoryFormDialog open onOpenChange={vi.fn()} category={null} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('categories.fieldName'), 'Marketing');
    await userEvent.click(screen.getByRole('radio', { name: 'rocket' }));
    await userEvent.click(screen.getByRole('button', { name: 'categories.create' }));

    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith({ name: 'Marketing', icon: 'rocket' }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('preloads the existing icon when editing', () => {
    render(<CategoryFormDialog open onOpenChange={vi.fn()} category={existing} onSaved={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'star' })).toHaveAttribute('aria-checked', 'true');
  });
});
