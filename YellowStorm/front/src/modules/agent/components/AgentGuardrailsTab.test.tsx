import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AgentGuardrails } from '../types';
import { AgentGuardrailsTab } from './AgentGuardrailsTab';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const guardrails: AgentGuardrails = {
  promptInjection: {
    inputEnabled: false,
    outputEnabled: false,
    mode: 'balanced',
    inputClassifierPrompt: '',
    outputClassifierPrompt: '',
    blockMessage: 'Blocked',
  },
  toolActionReview: {
    enabled: false,
    mode: 'balanced',
    classifierPrompt: '',
    blockMessage: 'Blocked',
  },
};

describe('AgentGuardrailsTab', () => {
  it('allows the tool-call guardrail to be enabled', async () => {
    const onChange = vi.fn();
    render(<AgentGuardrailsTab value={guardrails} disabled={false} forceActivation={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'createEdit.guardrails.toolCallGuardrail' }));

    expect(onChange).toHaveBeenCalledWith({ ...guardrails, toolActionReview: { ...guardrails.toolActionReview, enabled: true } });
  });

  it('keeps the tool-call guardrail disabled when organization guardrails are forced', () => {
    render(<AgentGuardrailsTab value={guardrails} disabled forceActivation onChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'createEdit.guardrails.toolCallGuardrail' })).toBeDisabled();
  });
});
