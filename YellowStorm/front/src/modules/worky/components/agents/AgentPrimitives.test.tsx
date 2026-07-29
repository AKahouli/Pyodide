import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (k: string) =>
      (({
        'agents.status.working': 'Working',
        'agents.status.blocked': 'Blocked',
        'agents.status.idle': 'Idle',
        'agents.status.done': 'Done',
      }) as Record<string, string>)[k] ?? k,
    language: 'en',
    ready: true,
  }),
}));

import { AgentStatusPill } from './AgentStatusPill';
import { AgentAvatar } from './AgentAvatar';

describe('AgentStatusPill', () => {
  it('shows the localized label and status color class', () => {
    render(<AgentStatusPill status="blocked" />);
    const el = screen.getByText('Blocked');
    expect(el).toBeTruthy();
    expect(el.className).toContain('text-worky-blocked');
  });
});

describe('AgentAvatar', () => {
  it('renders the initials with a status ring', () => {
    const { container } = render(<AgentAvatar initials="AT" colorSeed="seed" status="working" />);
    expect(screen.getByText('AT')).toBeTruthy();
    expect(container.querySelector('.ring-worky-working')).toBeTruthy();
  });
});
