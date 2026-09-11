import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureVisibilityCard } from './FeatureVisibilityCard';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));
const translate = vi.hoisted(() => (key: string) => key);

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: translate }),
}));

vi.mock('../api', () => ({
  getFeatureVisibility: apiMocks.get,
  updateFeatureVisibility: apiMocks.update,
}));

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));

vi.mock('@/lib/notifications', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const visibility = {
  conversation: true,
  workspace: true,
  playbook: true,
  governance: true,
  appMarketplace: true,
  worky: true,
  agents: true,
  semanticModel: true,
  platformCopilot: false,
  playbookDevtools: false,
  playbookDeltaAutosave: true,
  playbookMcpAssistant: true,
  governedConversations: true,
  governedScopeCarousel: true,
  dataRoomDecisionFlows: true,
};

describe('FeatureVisibilityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockResolvedValue(visibility);
    apiMocks.update.mockImplementation(async (value) => value);
  });

  it('loads, edits, and saves the complete feature visibility map', async () => {
    render(<FeatureVisibilityCard />);

    const playbook = await screen.findByLabelText('system.features.items.playbook.label');
    await waitFor(() => expect(playbook).toBeEnabled());
    await userEvent.click(playbook);
    await waitFor(() => expect(playbook).toHaveAttribute('aria-checked', 'false'));
    await userEvent.click(screen.getByRole('button', { name: 'system.features.actions.save' }));

    await waitFor(() => expect(apiMocks.update).toHaveBeenCalledWith({
      ...visibility,
      playbook: false,
    }));
  });
});
