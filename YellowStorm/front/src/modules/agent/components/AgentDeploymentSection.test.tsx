import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createWidgetTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/agent/api', () => ({
  createWidgetToken: createWidgetTokenMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: { children: ReactNode }) => <button {...rest}>{children}</button>,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, disabled, onCheckedChange, ...rest }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...rest}
    />
  ),
}));

vi.mock('./IntegrationSnippetPanel', () => ({
  IntegrationSnippetPanel: () => <div>embed-snippet-panel</div>,
}));

vi.mock('./WidgetRestApiPanel', () => ({
  WidgetRestApiPanel: () => <div>rest-api-panel</div>,
}));

import { AgentDeploymentSection } from './AgentDeploymentSection';

function DeploymentSectionHarness() {
  const [value, setValue] = useState({ embedEnabled: false, restEnabled: false });
  return <AgentDeploymentSection agentId="a1" agentName="Agent" value={value} onChange={setValue} />;
}

describe('AgentDeploymentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createWidgetTokenMock.mockResolvedValue({ token: 'token-1' });
  });

  it('hides deployment generate actions until each channel toggle is enabled', () => {
    render(<DeploymentSectionHarness />);

    expect(screen.queryByText('createEdit.actions.generateDeploymentSnippet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('embed-deployment-switch'));
    expect(screen.getAllByText('createEdit.actions.generateDeploymentSnippet')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('rest-deployment-switch'));
    expect(screen.getAllByText('createEdit.actions.generateDeploymentSnippet')).toHaveLength(2);
  });

  it('generates and renders embed output only after embed is enabled', async () => {
    render(<DeploymentSectionHarness />);

    fireEvent.click(screen.getByTestId('embed-deployment-switch'));
    fireEvent.click(screen.getByText('createEdit.actions.generateDeploymentSnippet'));

    await waitFor(() => {
      expect(createWidgetTokenMock).toHaveBeenCalledWith('a1');
    });
    expect(screen.getByText('embed-snippet-panel')).toBeInTheDocument();
    expect(screen.queryByText('rest-api-panel')).not.toBeInTheDocument();
  });
});
