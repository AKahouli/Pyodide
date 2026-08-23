import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlatformCopilotActivity } from './PlatformCopilotActivity';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('PlatformCopilotActivity', () => {
  it('shows safe progress and tool status without exposing raw reasoning or arguments', () => {
    render(<PlatformCopilotActivity isStreaming components={[
      { id: 'activity', type: 'agentActivity', data: { summary: 'Preparing validation', status: 'running' } },
      { id: 'tool', type: 'toolActivity', data: { toolName: 'validate_playbook', fallbackDisplayName: 'validate playbook', summary: '', renderKind: 'generic', status: 'completed', paramsJson: '{"password":"hidden"}', resultJson: '{"secret":"hidden"}' } },
    ]} />);

    expect(screen.queryByText('Review Playbook structure')).not.toBeInTheDocument();
    expect(screen.getAllByText('validate playbook')).toHaveLength(1);
    expect(screen.queryByText(/private chain of thought/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token=|password|resultJson|secret/)).not.toBeInTheDocument();
  });
});
