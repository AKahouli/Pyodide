import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybookDataBindingSection } from './PlaybookDataBindingSection';
import { makePlaybook, makeTask } from '../test-utils';

const storeFns = vi.hoisted(() => ({
  updateDataBindings: vi.fn(),
  updateEdges: vi.fn(),
}));

const currentPlaybookState = vi.hoisted(() => ({
  value: null as any,
}));

vi.mock('../store', () => ({
  useCurrentPlaybook: () => currentPlaybookState.value,
  usePlaybookStore: (selector: (state: typeof storeFns) => unknown) => selector(storeFns),
}));

describe('PlaybookDataBindingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows bindings grouped by target input port', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'source-1',
          title: 'Source Task',
          outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }],
        }),
        makeTask({
          id: 'target-1',
          title: 'Target Task',
          inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }],
        }),
      ],
      edges: [{ id: 'edge-1', sourceId: 'source-1', targetId: 'target-1' }],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-1',
        sourcePort: 'result',
        iteration: 'current',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    expect(screen.getByDisplayValue('Prompt')).toBeInTheDocument();
    expect(screen.getByText('ports.required')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Source Task' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Result' })).toBeInTheDocument();
  });

  it('creates a binding for an unbound port when a source kind is selected', async () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }] }),
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
      ],
      dataBindings: [],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0], 'node-output');

    expect(storeFns.updateDataBindings).toHaveBeenCalledWith([
      expect.objectContaining({
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      }),
    ]);
  });

  it('limits source node choices to upstream tasks that can reach the target', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }] }),
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
        makeTask({ id: 'detached-1', title: 'Detached Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }] }),
      ],
      edges: [{ id: 'edge-1', sourceId: 'source-1', targetId: 'target-1' }],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-1',
        sourcePort: 'result',
        iteration: 'current',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    expect(screen.getByRole('option', { name: 'Source Task' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Detached Task' })).not.toBeInTheDocument();
  });

  it('updates only the binding when an inspector edit switches away from node-output', async () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }] }),
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
      ],
      edges: [{ id: 'e-source-1-result-target-1-prompt', sourceId: 'source-1', targetId: 'target-1', sourceOutputPortId: 'result', targetInputPortId: 'prompt' }],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-1',
        sourcePort: 'result',
        iteration: 'current',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'constant' } });

    expect(storeFns.updateDataBindings).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'binding-1',
        sourceKind: 'constant',
      }),
    ]);
    expect(storeFns.updateEdges).not.toHaveBeenCalled();
  });

  it('clears stale node-output fields when switching to trigger', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }] }),
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }] }),
      ],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-1',
        sourcePort: 'result',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'trigger' } });

    expect(storeFns.updateDataBindings).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'binding-1',
        sourceKind: 'trigger',
        sourceNode: undefined,
        sourcePort: undefined,
      }),
    ]);
  });

  it('shows the warning marker beside an unbound required port', async () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }] }),
      ],
      dataBindings: [],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    expect(screen.getByLabelText('node.unboundRequiredPort')).toBeInTheDocument();
  });

  it('keeps the warning marker visible for an incomplete required node-output binding', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }] }),
      ],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    expect(screen.getByLabelText('node.unboundRequiredPort')).toBeInTheDocument();
  });

  it('allows removing an unmapped orphan binding', async () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
      ],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'missing-port',
        sourceKind: 'node-output',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    const removeButtons = screen.getAllByTitle('ports.removePort');
    await userEvent.click(removeButtons[removeButtons.length - 1]);

    expect(storeFns.updateDataBindings).toHaveBeenCalledWith([]);
  });

  it('still shows orphan binding recovery when no input ports remain', async () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [] }),
      ],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'missing-port',
        sourceKind: 'node-output',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    expect(screen.getByText('dataBindingEditor.unmappedTitle')).toBeInTheDocument();

    await userEvent.click(screen.getByTitle('ports.removePort'));

    expect(storeFns.updateDataBindings).toHaveBeenCalledWith([]);
  });

  it('preserves a mapped binding as an orphan when removing the only input port', async () => {
    const onInputPortsChange = vi.fn();

    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
      ],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      }],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" onInputPortsChange={onInputPortsChange} />);

    const removeButtons = screen.getAllByTitle('ports.removePort');
    await userEvent.click(removeButtons[0]);

    expect(onInputPortsChange).toHaveBeenCalledWith([]);
    expect(storeFns.updateDataBindings).not.toHaveBeenCalled();
  });
});
