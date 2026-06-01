import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlBlockerEditorDialog } from './HitlBlockerEditorDialog';

const normalizeHitlBlockerMock = vi.fn();
const createBlockerMutateAsync = vi.fn();

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/playbook/api', () => ({
  normalizeHitlBlocker: (...args: unknown[]) => normalizeHitlBlockerMock(...args),
}));

vi.mock('@/modules/playbook/query/hooks/useHitlMutations', () => ({
  useCreateHitlBlockerMutation: () => ({ mutateAsync: createBlockerMutateAsync, isPending: false }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe('HitlBlockerEditorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeHitlBlockerMock.mockResolvedValue({
      kind: 'external_send',
      label: 'Approve outbound emails',
      description: 'Ask before sending external emails.',
      action: 'approve',
      riskLevel: 'high',
      sensitivity: 'balanced',
      matcherType: 'llm_judge',
      matcherConfig: { naturalLanguageRule: 'Ask before sending external emails.' },
    });
    createBlockerMutateAsync.mockResolvedValue({ id: 'blocker-1' });
  });

  it('normalizes natural language before creating a node blocker', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<HitlBlockerEditorDialog flowId="flow-1" nodeId="node-1" open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText('hitl.editor.ruleLabel'), ' Ask before sending external emails. ');
    await user.click(screen.getByRole('button', { name: 'hitl.editor.save' }));

    expect(normalizeHitlBlockerMock).toHaveBeenCalledWith('flow-1', {
      description: 'Ask before sending external emails.',
      nodeId: 'node-1',
    });
    await waitFor(() => expect(createBlockerMutateAsync).toHaveBeenCalledWith({
      flowId: 'flow-1',
      data: expect.objectContaining({
        kind: 'external_send',
        label: 'Approve outbound emails',
        description: 'Ask before sending external emails.',
        action: 'approve',
        scope: 'node',
        nodeId: 'node-1',
      }),
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates workflow blockers with workflow scope when no node is selected', async () => {
    const user = userEvent.setup();
    render(<HitlBlockerEditorDialog flowId="flow-1" open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText('hitl.editor.ruleLabel'), 'Ask before sending external emails.');
    await user.click(screen.getByRole('button', { name: 'hitl.editor.save' }));

    await waitFor(() => expect(createBlockerMutateAsync).toHaveBeenCalledWith({
      flowId: 'flow-1',
      data: expect.objectContaining({ scope: 'workflow', nodeId: null }),
    }));
  });

  it('keeps the dialog open and reports normalization failures', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    normalizeHitlBlockerMock.mockRejectedValueOnce(new Error('Normalizer unavailable'));
    render(<HitlBlockerEditorDialog flowId="flow-1" open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText('hitl.editor.ruleLabel'), 'Ask before sending external emails.');
    await user.click(screen.getByRole('button', { name: 'hitl.editor.save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Normalizer unavailable');
    expect(createBlockerMutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'hitl.editor.save' })).toBeEnabled();
  });
});
