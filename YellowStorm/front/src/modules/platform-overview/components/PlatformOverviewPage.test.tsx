import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformOverviewPage } from './PlatformOverviewPage';

const accessState = vi.hoisted(() => ({
  hasAdminAccess: false,
  canOpenGovernance: false,
  canOpenSemanticModels: false,
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
    hasAnyPermission: (permissions: string[]) => {
      if (permissions.some((permission) => permission.startsWith('governance'))) {
        return accessState.canOpenGovernance;
      }
      if (permissions.some((permission) => permission.startsWith('semantic_models'))) {
        return accessState.canOpenSemanticModels;
      }
      return false;
    },
  }),
}));

describe('PlatformOverviewPage', () => {
  beforeEach(() => {
    accessState.hasAdminAccess = false;
    accessState.canOpenGovernance = false;
    accessState.canOpenSemanticModels = false;
  });

  it('recommends capability chains from business goals and keeps conversation primary', () => {
    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'hero.title' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /hero.startConversation/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /goal.answer.title/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /goal.knowledge.title/ })).toHaveAttribute('href', '/workspace');
    expect(screen.getByRole('link', { name: /goal.automate.title/ })).toHaveAttribute('href', '/playbooks');
    expect(screen.getByRole('heading', { name: 'goal.govern.title' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /goal.govern.title/ })).not.toBeInTheDocument();
    expect(screen.getByText('goal.answer.chain')).toBeInTheDocument();
    expect(screen.getByText('goal.govern.chain')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).filter((heading) => heading.textContent?.startsWith('journey.'))).toHaveLength(4);
  });

  it('presents reliability evidence, direct destinations, and Worky guidance', () => {
    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'trust.title' })).toBeInTheDocument();
    expect(screen.getByText('trust.score.description')).toBeInTheDocument();
    expect(screen.getByText('trust.claims.description')).toBeInTheDocument();
    expect(screen.getByText('trust.audit.description')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'quick.marketplace' })).toHaveAttribute('href', '/app-builder');
    expect(screen.getAllByRole('link', { name: /authorizations/ })).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathname: '/connected-apps' })]),
    );
    expect(screen.getByRole('link', { name: 'worky.launchAriaLabel' })).toHaveAttribute('href', '/worky');
  });

  it('keeps restricted governance, semantic models, and administration non-interactive', () => {
    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'journey.governance.action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /journey.context.semanticModels/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('access.restricted')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'lens.atlas' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'lens.administration' })).not.toBeInTheDocument();
  });

  it('maps platform capabilities while keeping restricted atlas destinations non-interactive', async () => {
    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('tab', { name: 'lens.journey' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'lens.atlas' }));

    expect(screen.getByRole('heading', { level: 1, name: 'atlas.title' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /atlas.conversation.title/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /atlas.workspace.title/ })).toHaveAttribute('href', '/workspace');
    expect(screen.getByRole('link', { name: /atlas.agents.title/ })).toHaveAttribute('href', '/agents');
    expect(screen.getByRole('link', { name: /atlas.teams.title/ })).toHaveAttribute('href', '/teams');
    expect(screen.getByRole('link', { name: /atlas.groups.title/ })).toHaveAttribute('href', '/groups');
    expect(screen.getByRole('link', { name: /atlas.worky.title/ })).toHaveAttribute('href', '/worky');
    expect(screen.getByRole('link', { name: /atlas.playbooks.title/ })).toHaveAttribute('href', '/playbooks');
    expect(screen.getByRole('link', { name: /atlas.connectedApps.title/ })).toHaveAttribute('href', '/connected-apps');
    expect(screen.getByRole('link', { name: /atlas.marketplace.title/ })).toHaveAttribute('href', '/app-builder');
    expect(screen.queryByRole('link', { name: /atlas.semanticModels.title/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /atlas.governance.title/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('access.restricted')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'worky.launchAriaLabel' })).toHaveAttribute('href', '/worky');
  });

  it('shows permission-filtered destinations and administration controls to authorized users', async () => {
    accessState.hasAdminAccess = true;
    accessState.canOpenGovernance = true;
    accessState.canOpenSemanticModels = true;

    render(
      <MemoryRouter>
        <PlatformOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'journey.governance.action' })).toHaveAttribute('href', '/governance');
    expect(screen.getByRole('link', { name: /goal.govern.title/ })).toHaveAttribute('href', '/governance');
    expect(screen.getByRole('link', { name: /journey.context.semanticModels/ })).toHaveAttribute('href', '/semantic-models');

    await userEvent.click(screen.getByRole('tab', { name: 'lens.atlas' }));
    expect(screen.getByRole('link', { name: /atlas.semanticModels.title/ })).toHaveAttribute('href', '/semantic-models');
    expect(screen.getByRole('link', { name: /atlas.governance.title/ })).toHaveAttribute('href', '/governance');

    await userEvent.click(screen.getByRole('tab', { name: 'lens.administration' }));
    expect(screen.getByRole('heading', { level: 1, name: 'administration.title' })).toBeInTheDocument();
    expect(screen.getByText('menu.analytics.label')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'administration.open' })).toHaveAttribute('href', '/admin/analytics');
    expect(screen.getByRole('link', { name: /administration.console/ })).toHaveAttribute('href', '/admin');
  });
});
