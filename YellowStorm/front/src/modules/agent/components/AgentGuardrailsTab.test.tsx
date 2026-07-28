import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PromptInjectionGuardrailsConfig } from '../types';
import { AgentGuardrailsTab } from './AgentGuardrailsTab';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const guardrails: PromptInjectionGuardrailsConfig = {
  inputGuardrailEnabled: false,
  outputGuardrailEnabled: false,
  toolCallGuardrailEnabled: false,
  inputClassifierPrompt: '',
  outputClassifierPrompt: '',
  toolCallClassifierPrompt: '',
  blockMessage: 'Blocked',
};

describe('AgentGuardrailsTab', () => {
  it('allows the tool-call guardrail to be enabled', async () => {
    const onChange = vi.fn();
    render(<AgentGuardrailsTab value={guardrails} disabled={false} forceActivation={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'createEdit.guardrails.toolCallGuardrail' }));

    expect(onChange).toHaveBeenCalledWith({ ...guardrails, toolCallGuardrailEnabled: true });
  });

  it('keeps the tool-call guardrail disabled when organization guardrails are forced', () => {
    render(<AgentGuardrailsTab value={guardrails} disabled forceActivation onChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'createEdit.guardrails.toolCallGuardrail' })).toBeDisabled();
  });
});
