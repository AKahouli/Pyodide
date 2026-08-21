import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlatformCopilotActivity } from './PlatformCopilotActivity';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('PlatformCopilotActivity', () => {
  it('shows safe progress and tool status without exposing raw reasoning or arguments', () => {
    render(<PlatformCopilotActivity isStreaming components={[
      { id: 'reasoning', type: 'reasoning', data: { content: 'private chain of thought' } },
      { id: 'steps', type: 'chainOfThought', data: { steps: ['Review Playbook structure', 'validate_playbook', '<private>hidden</private>', 'token=secret'] } },
      { id: 'tool', type: 'toolInfo', data: { title: 'validate_playbook', status: 'completed', params: '{"password":"hidden"}', resultJson: '{"secret":"hidden"}' } },
    ]} />);

    expect(screen.queryByText('Review Playbook structure')).not.toBeInTheDocument();
    expect(screen.getAllByText('validate playbook')).toHaveLength(1);
    expect(screen.queryByText(/private chain of thought/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token=|password|resultJson|secret/)).not.toBeInTheDocument();
  });
});
