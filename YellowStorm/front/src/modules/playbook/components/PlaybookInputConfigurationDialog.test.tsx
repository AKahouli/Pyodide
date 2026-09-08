import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybookInputDescriptor } from '../types';
import {
  canDismissPlaybookInputConfiguration,
  PlaybookInputConfigurationDialog,
} from './PlaybookInputConfigurationDialog';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./PlaybookInputSourcePicker', () => ({
  PlaybookInputSourcePicker: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button type="button" onClick={() => onChange('selected')}>select-value</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) => open ? (
    <div>
      <button type="button" onClick={() => onOpenChange(false)}>dismiss-escape</button>
      <button type="button" onClick={() => onOpenChange(false)}>dismiss-outside</button>
      {children}
    </div>
  ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

const input: PlaybookInputDescriptor = {
  id: 'input-1',
  taskId: 'task-1',
  taskTitle: 'Task',
  portId: 'destination',
  label: 'Destination',
  artifactKind: 'document',
  required: true,
  scope: 'configuration',
  binding: { kind: 'missing' },
  acceptedSources: ['workspace'],
  readiness: 'configuration_required',
};

const baseProps = {
  input,
  value: 'selected',
  dirty: false,
  onValueChange: vi.fn(),
  onDismiss: vi.fn(),
  onSave: vi.fn().mockResolvedValue(false),
  onSaveError: vi.fn(),
};

describe('PlaybookInputConfigurationDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the same dirty guard for cancel, Escape, and outside-click dismissal', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { rerender } = render(<PlaybookInputConfigurationDialog {...baseProps} dirty onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'dismiss-escape' }));
    await user.click(screen.getByRole('button', { name: 'dismiss-outside' }));
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(<PlaybookInputConfigurationDialog {...baseProps} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'dismiss-escape' }));
    await user.click(screen.getByRole('button', { name: 'dismiss-outside' }));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it('blocks dismissal while saving and closes through the guard after save settles', async () => {
    const user = userEvent.setup();
    let resolveSave!: (saved: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
    const onDismiss = vi.fn();
    render(<PlaybookInputConfigurationDialog {...baseProps} onSave={onSave} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'inputs.saveConfiguration' }));
    await user.click(screen.getByRole('button', { name: 'dismiss-escape' }));
    await user.click(screen.getByRole('button', { name: 'dismiss-outside' }));
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => resolveSave(true));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
  });

  it('allows dismissal only when neither dirty nor saving', () => {
    expect(canDismissPlaybookInputConfiguration(false, false)).toBe(true);
    expect(canDismissPlaybookInputConfiguration(true, false)).toBe(false);
    expect(canDismissPlaybookInputConfiguration(false, true)).toBe(false);
  });
});
