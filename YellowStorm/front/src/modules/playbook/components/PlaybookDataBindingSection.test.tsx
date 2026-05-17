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

    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('dataBindingEditor.required')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Source Task' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Result' })).toBeInTheDocument();
  });

  it('creates a binding for an unbound port from the grouped bind action', async () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'text' }] }),
        makeTask({ id: 'target-1', title: 'Target Task', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
      ],
      dataBindings: [],
    });

    render(<PlaybookDataBindingSection targetNodeId="target-1" />);

    await userEvent.click(screen.getByRole('button', { name: 'dataBindingEditor.bindPort' }));

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
});
