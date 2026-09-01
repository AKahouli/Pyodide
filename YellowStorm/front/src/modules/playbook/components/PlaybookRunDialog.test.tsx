import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlaybookInputContract } from '../types';
import { PlaybookRunDialog } from './PlaybookRunDialog';

vi.mock('./PlaybookClarificationResourcePicker', () => ({
  PlaybookClarificationResourcePicker: () => null,
}));

const contract: PlaybookInputContract = {
  playbookId: 'playbook-1',
  definitionRevision: 3,
  graphValid: true,
  configurationReady: true,
  runtimeInputCount: 2,
  invalidInputCount: 0,
  inputs: [
    {
      id: 'step-1:brief',
      taskId: 'step-1',
      taskTitle: 'Draft report',
      portId: 'brief',
      label: 'Brief',
      artifactKind: 'text',
      required: true,
      scope: 'runtime',
      binding: { kind: 'trigger', triggerPath: 'playbookInputs.brief' },
      acceptedSources: ['manual'],
      readiness: 'runtime_required',
    },
    {
      id: 'step-2:dataset',
      taskId: 'step-2',
      taskTitle: 'Analyze data',
      portId: 'dataset',
      label: 'Dataset',
      artifactKind: 'data',
      required: true,
      scope: 'runtime',
      binding: { kind: 'trigger', triggerPath: 'playbookInputs.dataset' },
      acceptedSources: ['manual'],
      readiness: 'runtime_required',
    },
  ],
};

describe('PlaybookRunDialog', () => {
  it('builds nested runtime input context and parses data inputs', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <PlaybookRunDialog
        open
        onOpenChange={onOpenChange}
        playbookName="Quarterly report"
        contract={contract}
        onRun={onRun}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Brief' }), 'Focus on renewals');
    fireEvent.change(screen.getByRole('textbox', { name: 'Dataset' }), { target: { value: '{"quarter":4}' } });
    await user.click(screen.getByRole('button', { name: 'inputs.run' }));

    expect(onRun).toHaveBeenCalledWith({
      playbookInputs: {
        brief: 'Focus on renewals',
        dataset: { quarter: 4 },
      },
    }, expect.any(String));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open and reports invalid JSON', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PlaybookRunDialog
        open
        onOpenChange={onOpenChange}
        playbookName="Quarterly report"
        contract={contract}
        onRun={onRun}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Brief' }), 'Focus on renewals');
    await user.type(screen.getByRole('textbox', { name: 'Dataset' }), 'not-json');
    await user.click(screen.getByRole('button', { name: 'inputs.run' }));

    expect(screen.getByRole('alert')).toHaveTextContent('inputs.invalidJson');
    expect(onRun).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
