import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlBlockerCenter } from './HitlBlockerCenter';
import type { HitlBlockerRule } from '@/modules/playbook/types';

const updateBlockerMutate = vi.fn();
const deleteBlockerMutate = vi.fn();
let blockerData: HitlBlockerRule[] = [];

function makeBlocker(overrides: Partial<HitlBlockerRule> = {}): HitlBlockerRule {
  return {
  id: 'blocker-1',
  scope: 'workflow',
  nodeId: null,
  enabled: true,
  kind: 'custom',
  label: 'Ask before sending',
  description: 'Ask me before sending external emails.',
  action: 'approve',
  riskLevel: 'high',
  sensitivity: 'balanced',
  matcherType: 'llm_judge',
  matcherConfig: {},
  promptTemplate: null,
  appliesToToolNames: [],
  appliesToConnectorActions: [],
  createdBy: 'user',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...overrides,
  };
}

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, disabled, onCheckedChange, 'aria-label': ariaLabel }: {
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
    'aria-label': string;
  }) => (
    <input
      aria-label={ariaLabel}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('@/modules/playbook/query/hooks/useHitlQueries', () => ({
  useHitlBlockersQuery: () => ({ data: blockerData }),
}));

vi.mock('@/modules/playbook/query/hooks/useHitlMutations', () => ({
  useUpdateHitlBlockerMutation: () => ({ mutate: updateBlockerMutate, isPending: false }),
  useDeleteHitlBlockerMutation: () => ({ mutate: deleteBlockerMutate, isPending: false }),
}));

vi.mock('./HitlPolicySummaryCard', () => ({
  HitlPolicySummaryCard: () => <div data-testid="hitl-policy-summary" />,
}));

vi.mock('./HitlMemoryPanel', () => ({
  HitlMemoryPanel: () => <div data-testid="hitl-memory-panel" />,
}));

vi.mock('./HitlBlockerEditorDialog', () => ({
  HitlBlockerEditorDialog: () => null,
}));

describe('HitlBlockerCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blockerData = [makeBlocker()];
  });

  it('persists workflow blocker toggle changes', async () => {
    const user = userEvent.setup();
    render(<HitlBlockerCenter flowId="flow-1" showMemory={false} />);

    await user.click(screen.getByLabelText('hitl.blockers.toggle'));

    expect(updateBlockerMutate).toHaveBeenCalledWith({
      flowId: 'flow-1',
      blockerId: 'blocker-1',
      data: { enabled: false },
    });
  });

  it('shows only workflow blockers in workflow mode and hides memory when requested', () => {
    blockerData = [
      makeBlocker({ id: 'workflow-blocker', scope: 'workflow', nodeId: null, label: 'Workflow rule' }),
      makeBlocker({ id: 'node-blocker', scope: 'node', nodeId: 'node-1', label: 'Node rule' }),
    ];

    render(<HitlBlockerCenter flowId="flow-1" showMemory={false} />);

    expect(screen.getByText('Workflow rule')).toBeInTheDocument();
    expect(screen.queryByText('Node rule')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hitl-memory-panel')).not.toBeInTheDocument();
  });

  it('shows only blockers for the selected node', () => {
    blockerData = [
      makeBlocker({ id: 'workflow-blocker', scope: 'workflow', nodeId: null, label: 'Workflow rule' }),
      makeBlocker({ id: 'node-blocker-1', scope: 'node', nodeId: 'node-1', label: 'Node one rule' }),
      makeBlocker({ id: 'node-blocker-2', scope: 'node', nodeId: 'node-2', label: 'Node two rule' }),
    ];

    render(<HitlBlockerCenter flowId="flow-1" nodeId="node-1" showMemory={false} />);

    expect(screen.getByText('Node one rule')).toBeInTheDocument();
    expect(screen.queryByText('Workflow rule')).not.toBeInTheDocument();
    expect(screen.queryByText('Node two rule')).not.toBeInTheDocument();
  });

  it('deletes user-created blockers through the delete mutation', async () => {
    const user = userEvent.setup();
    render(<HitlBlockerCenter flowId="flow-1" showMemory={false} />);

    await user.click(screen.getByRole('button', { name: '' }));

    expect(deleteBlockerMutate).toHaveBeenCalledWith({ flowId: 'flow-1', blockerId: 'blocker-1' });
  });

  it('renders empty workflow and node states', () => {
    blockerData = [];
    const { rerender } = render(<HitlBlockerCenter flowId="flow-1" showMemory={false} />);

    expect(screen.getByText('hitl.blockers.emptyWorkflow')).toBeInTheDocument();

    rerender(<HitlBlockerCenter flowId="flow-1" nodeId="node-1" showMemory={false} />);

    expect(screen.getByText('hitl.blockers.emptyNode')).toBeInTheDocument();
  });
});
