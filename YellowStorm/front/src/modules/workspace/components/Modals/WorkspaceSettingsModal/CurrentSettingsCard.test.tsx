import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CurrentSettingsCard } from './CurrentSettingsCard';

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type='button'>{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('CurrentSettingsCard', () => {
  it('calls onClear when clear action is confirmed', async () => {
    const onClear = vi.fn();

    render(
      <CurrentSettingsCard
        currentSettings={{
          id: 's1',
          name: 'Template A',
          isTemplate: true,
          isPredefined: false,
          createdBy: 'u1',
          chunks: 4,
          ragType: 'standard',
          topK: 5,
          maxToken: 4000,
          hybridSearch: true,
          createdAt: '',
          updatedAt: '',
        }}
        onClear={onClear}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'settings.current.clearAction' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
