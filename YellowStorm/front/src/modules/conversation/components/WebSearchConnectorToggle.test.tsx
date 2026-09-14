import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationStore } from '../store';
import { WebSearchConnectorToggle } from './WebSearchConnectorToggle';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('WebSearchConnectorToggle', () => {
  beforeEach(() => useConversationStore.setState({ webConnectorAccessEnabled: true }));

  it('toggles Web Search connector access', async () => {
    render(<WebSearchConnectorToggle />);
    const toggle = screen.getByRole('button', { name: 'input.webSearch' });

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(useConversationStore.getState().webConnectorAccessEnabled).toBe(false);
  });
});
