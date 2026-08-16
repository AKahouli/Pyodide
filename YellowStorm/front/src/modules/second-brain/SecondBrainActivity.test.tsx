import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SecondBrainActivity } from './SecondBrainActivity';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('SecondBrainActivity', () => {
  it('shows safe progress and tool status without exposing raw reasoning or arguments', () => {
    render(<SecondBrainActivity isStreaming components={[
      { id: 'reasoning', type: 'reasoning', data: { content: 'private chain of thought' } },
      { id: 'steps', type: 'chainOfThought', data: { steps: ['Review Playbook structure', 'validate_playbook', '<private>hidden</private>', 'token=secret'] } },
      { id: 'tool', type: 'toolInfo', data: { title: 'validate_playbook', status: 'completed', params: '{"password":"hidden"}', resultJson: '{"secret":"hidden"}' } },
    ]} />);

    expect(screen.getByText('Review Playbook structure')).toBeInTheDocument();
    expect(screen.getAllByText('validate playbook')).toHaveLength(1);
    expect(screen.queryByText(/private chain of thought/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token=|password|resultJson|secret/)).not.toBeInTheDocument();
  });
});
