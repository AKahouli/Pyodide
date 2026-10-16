import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { CategoryIconPicker } from './CategoryIconPicker';
import { CATEGORY_ICON_GROUPS } from './category-icons';

describe('CategoryIconPicker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the placeholder when no icon is selected', () => {
    render(<CategoryIconPicker value='' onChange={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveTextContent('categories.selectIcon');
  });

  it('renders every icon group and its icons', () => {
    render(<CategoryIconPicker value='' onChange={vi.fn()} />);

    for (const group of CATEGORY_ICON_GROUPS) {
      expect(screen.getByRole('radiogroup', { name: `categories.iconGroups.${group.key}` })).toBeInTheDocument();
      for (const iconName of group.icons) {
        expect(screen.getByRole('radio', { name: iconName })).toBeInTheDocument();
      }
    }
  });

  it('calls onChange with the selected icon slug', async () => {
    const onChange = vi.fn();
    render(<CategoryIconPicker value='' onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'rocket' }));

    expect(onChange).toHaveBeenCalledWith('rocket');
  });

  it('clears the selection when choosing "no icon"', async () => {
    const onChange = vi.fn();
    render(<CategoryIconPicker value='rocket' onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'categories.noIcon' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('marks the current value as checked', () => {
    render(<CategoryIconPicker value='rocket' onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'rocket' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'star' })).toHaveAttribute('aria-checked', 'false');
  });
});
