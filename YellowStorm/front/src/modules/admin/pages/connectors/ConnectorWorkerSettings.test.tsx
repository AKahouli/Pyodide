import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorWorkerSettings } from './ConnectorWorkerSettings';
import type { ConnectorActionResponse } from '../../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, values?: Record<string, string>) => `${key}${values?.tool ? ` ${values.tool}` : ''}` }),
}));

function Fixture() {
  const [policy, setPolicy] = useState({ enabled: true, defaultExecutionKind: 'leaf' as const, agentLaunchEnabled: false });
  const [actions, setActions] = useState(Array.from({ length: 200 }, (_, i) => ({
    key: `search_${i}`, label: `Search ${i}`, safety: 'read', executionKind: i === 1 ? 'unknown' : i === 2 ? 'orchestration' : 'inherit',
  })) as ConnectorActionResponse[]);
  return <ConnectorWorkerSettings policy={policy} actions={actions} onPolicyChange={(next) => setPolicy(next as typeof policy)} onActionsChange={setActions} />;
}

describe('connector worker settings', () => {
  it('starts ON and filters a large tool catalog without losing the default', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    expect(screen.getByRole('switch', { name: 'connectors.workers.enabled' })).toBeChecked();
    await user.type(screen.getByRole('textbox'), 'Search 199');
    expect(screen.getByText('Search 199')).toBeInTheDocument();
    expect(screen.queryByText('Search 198')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'connectors.workers.accessLabel Search 199' })).toHaveTextContent('connectors.workers.access.inherit');
  });
  it('bulk adoption preserves known orchestration exceptions', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'connectors.workers.adoptDefault' }));
    await user.click(screen.getByRole('switch', { name: 'connectors.workers.exceptions' }));
    expect(screen.queryByText('Search 1')).not.toBeInTheDocument();
    expect(screen.getByText('Search 2')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'connectors.workers.kindLabel Search 2' })).toHaveTextContent('connectors.workers.kind.orchestration');
  });
});
