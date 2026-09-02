import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PendingApprovalPage } from './PendingApprovalPage';

const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});

vi.mock('@/components/AppBrandLogo', () => ({
  AppBrandLogo: ({ className }: { className?: string }) => (
    <div data-testid='app-logo' className={className}>
      logo
    </div>
  ),
}));

describe('PendingApprovalPage', () => {
  it('renders the logo, warning alert, message, and logs out', async () => {
    const onLogout = vi.fn();
    render(<PendingApprovalPage onLogout={onLogout} />);

    expect(screen.getByTestId('app-logo')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('pendingApproval.message');
    expect(screen.getByRole('alert').querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'pendingApproval.logout' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'pendingApproval.logout' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
