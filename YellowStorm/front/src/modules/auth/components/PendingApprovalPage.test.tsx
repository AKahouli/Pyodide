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

vi.mock('@/modules/conversation/effects/stars-background', () => ({
  StarsBackground: () => <div data-testid='stars-bg' />,
}));

describe('PendingApprovalPage', () => {
  it('renders the waiting steps, email hint, and logs out', async () => {
    const onLogout = vi.fn();
    render(<PendingApprovalPage onLogout={onLogout} />);

    expect(screen.getByTestId('app-logo')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'pendingApproval.heroAlt' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('pendingApproval.welcomePrefix');
    expect(screen.getByText('pendingApproval.success')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.steps.signup.label')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.steps.validation.status')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.steps.access.status')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.message')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.emailHint')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'pendingApproval.logout' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('shows declined access when Super Admin rejected the request', () => {
    render(<PendingApprovalPage onLogout={vi.fn()} rejected />);

    expect(screen.getByText('pendingApproval.steps.validation.statusDone')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.steps.access.statusRejected')).toBeInTheDocument();
    expect(screen.getByText('pendingApproval.messageRejected')).toBeInTheDocument();
    expect(screen.queryByText('pendingApproval.message')).not.toBeInTheDocument();
    expect(screen.queryByText('pendingApproval.emailHint')).not.toBeInTheDocument();
    expect(screen.queryByText('pendingApproval.steps.access.status')).not.toBeInTheDocument();
  });
});
