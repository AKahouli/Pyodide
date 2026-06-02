import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlPolicySummaryCard } from './HitlPolicySummaryCard';
import type { HitlPolicy } from '@/modules/playbook/types';

const updatePolicyMutate = vi.fn();
let policyData: HitlPolicy | undefined;

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

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, disabled, onValueChange }: { value: string; disabled?: boolean; onValueChange: (value: string) => void }) => (
    <select aria-label="hitl.sensitivity" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      <option value="minimal">hitl.sensitivity.minimal</option>
      <option value="balanced">hitl.sensitivity.balanced</option>
      <option value="strict">hitl.sensitivity.strict</option>
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock('@/modules/playbook/query/hooks/useHitlQueries', () => ({
  useHitlPolicyQuery: () => ({ data: policyData }),
}));

vi.mock('@/modules/playbook/query/hooks/useHitlMutations', () => ({
  useUpdateHitlPolicyMutation: () => ({ mutate: updatePolicyMutate, isPending: false }),
}));

describe('HitlPolicySummaryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyData = { mode: 'auto', sensitivity: 'balanced', inheritedFromWorkflow: false } as HitlPolicy;
  });

  it('persists workflow Smart HITL toggle changes', async () => {
    const user = userEvent.setup();
    render(<HitlPolicySummaryCard flowId="flow-1" />);

    await user.click(screen.getByLabelText('hitl.policy.toggle'));

    expect(updatePolicyMutate).toHaveBeenCalledWith(
      { flowId: 'flow-1', nodeId: undefined, data: { mode: 'off' } },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('persists node override policy changes with the node id', () => {
    policyData = { mode: 'auto', sensitivity: 'balanced', inheritedFromWorkflow: true } as HitlPolicy;
    render(<HitlPolicySummaryCard flowId="flow-1" nodeId="node-1" />);

    expect(screen.getByText('hitl.policy.inherited')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('hitl.sensitivity'), { target: { value: 'strict' } });

    expect(updatePolicyMutate).toHaveBeenCalledWith(
      { flowId: 'flow-1', nodeId: 'node-1', data: { sensitivity: 'strict' } },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('persists manual mode from the policy summary action', async () => {
    const user = userEvent.setup();
    render(<HitlPolicySummaryCard flowId="flow-1" />);

    await user.click(screen.getByRole('button', { name: 'hitl.policy.manual' }));

    expect(updatePolicyMutate).toHaveBeenCalledWith(
      { flowId: 'flow-1', nodeId: undefined, data: { mode: 'manual' } },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });
});
