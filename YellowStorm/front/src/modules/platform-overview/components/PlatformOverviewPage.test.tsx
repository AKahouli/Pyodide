import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformOverviewPage } from './PlatformOverviewPage';

const accessState = vi.hoisted(() => ({
  hasAdminAccess: false,
  canOpenGovernance: false,
}));

const adminItems = vi.hoisted(() => [
  {
    id: 'analytics',
    path: '/admin/analytics',
    labelKey: 'menu.analytics.label',
    descriptionKey: 'menu.analytics.description',
    icon: () => <span>analytics-icon</span>,
  },
]);

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/admin/hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({
    hasAdminAccess: accessState.hasAdminAccess,
    accessibleMenuItems: adminItems,
  }),
}));

vi.mock('@/modules/admin/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasAnyPermission: () => accessState.canOpenGovernance,
  }),
}));

describe('PlatformOverviewPage', () => {
  beforeEach(() => {
    accessState.hasAdminAccess = false;
    accessState.canOpenGovernance = false;
  });

  it('presents the platform capabilities with functional destinations', () => {
    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'hero.title' })).toBeInTheDocument();
    expect(screen.getByText('pane.knowledge.title')).toBeInTheDocument();
    expect(screen.getByText('pane.collaboration.title')).toBeInTheDocument();
    expect(screen.getByText('pane.automation.title')).toBeInTheDocument();
    expect(screen.getByText('pane.governance.title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /feature.workspace.title/ })).toHaveAttribute('href', '/workspace');
    expect(screen.getByRole('link', { name: /feature.conversation.title/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /feature.agents.title/ })).toHaveAttribute('href', '/agents');
    expect(screen.getByRole('link', { name: /feature.playbooks.title/ })).toHaveAttribute('href', '/playbooks');
    expect(screen.getByRole('link', { name: /feature.worky.title/ })).toHaveAttribute('href', '/worky');
  });

  it('keeps restricted governance and administration destinations non-interactive', () => {
    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /feature.governance.title/ })).not.toBeInTheDocument();
    expect(screen.getByText('feature.governance.restricted')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'lens.administration' })).not.toBeInTheDocument();
  });

  it('shows permission-filtered administration destinations to administrators', async () => {
    accessState.hasAdminAccess = true;
    accessState.canOpenGovernance = true;

    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /feature.governance.title/ })).toHaveAttribute('href', '/governance');
    await userEvent.click(screen.getByRole('tab', { name: 'lens.administration' }));
    expect(screen.getByText('menu.analytics.label')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'feature.explore' })).toHaveAttribute('href', '/admin/analytics');
    expect(screen.getByRole('link', { name: /administration.console/ })).toHaveAttribute('href', '/admin');
  });
});
