import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PlaybookRouterConfigSection } from './PlaybookRouterConfigSection';
import { makePlaybook, makeTask } from '../test-utils';
import type { RouterConfig } from '../types';

const currentPlaybookState = vi.hoisted(() => ({
  value: null as any,
}));

vi.mock('../store', () => ({
  useCurrentPlaybook: () => currentPlaybookState.value,
}));

describe('PlaybookRouterConfigSection', () => {
  it('keeps focus while typing an output label', async () => {
    currentPlaybookState.value = makePlaybook();

    function Harness() {
      const [value, setValue] = useState<RouterConfig>({
        outputLabels: ['retry', 'done', '__error__'],
        maxIterations: 3,
        defaultLabel: 'retry',
        conditions: [],
      });

      return <PlaybookRouterConfigSection value={value} onChange={setValue} />;
    }

    render(<Harness />);

    const input = screen.getAllByRole('textbox')[0];
    await userEvent.click(input);
    await userEvent.type(input, 'x');

    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue('retryx');
  });

  it('adds a deterministic condition with source selectors', async () => {
    const onChange = vi.fn();
    currentPlaybookState.value = makePlaybook({
      edges: [{ id: 'edge-1', sourceId: 'source-1', targetId: 'router-1' }],
    });

    render(
      <PlaybookRouterConfigSection
        value={{ outputLabels: ['valid', 'invalid'], maxIterations: 3, defaultLabel: 'invalid', conditions: [] }}
        onChange={onChange}
        tasks={[
          makeTask({
            id: 'source-1',
            title: 'Source Task',
            outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'data' }],
          }),
        ]}
        targetTaskId="router-1"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'routerEditor.addCondition' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      defaultLabel: 'invalid',
      conditions: [expect.objectContaining({
        label: 'valid',
        sourceNode: 'source-1',
        sourcePort: 'result',
        operator: 'equals',
      })],
    }));
  });

  it('parses numeric comparison values for router conditions', async () => {
    const onChange = vi.fn();
    currentPlaybookState.value = makePlaybook({
      edges: [{ id: 'edge-1', sourceId: 'source-1', targetId: 'router-1' }],
    });

    render(
      <PlaybookRouterConfigSection
        value={{
          outputLabels: ['valid', 'invalid'],
          maxIterations: 3,
          defaultLabel: 'invalid',
          conditions: [{
            label: 'valid',
            sourceNode: 'source-1',
            sourcePort: 'score',
            operator: 'gt',
          }],
        }}
        onChange={onChange}
        tasks={[makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'score', name: 'Score', artifactKind: 'data' }] })]}
        targetTaskId="router-1"
      />,
    );

    const valueInputs = screen.getAllByRole('textbox');
    fireEvent.change(valueInputs[valueInputs.length - 1], { target: { value: '42' } });

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      conditions: [expect.objectContaining({
        operator: 'gt',
        value: 42,
      })],
    }));
  });

  it('limits deterministic condition sources to upstream tasks', () => {
    currentPlaybookState.value = makePlaybook({
      edges: [{ id: 'edge-1', sourceId: 'source-1', targetId: 'router-1' }],
    });

    render(
      <PlaybookRouterConfigSection
        value={{
          outputLabels: ['valid', 'invalid'],
          maxIterations: 3,
          defaultLabel: 'invalid',
          conditions: [{ label: 'valid', operator: 'equals' }],
        }}
        onChange={vi.fn()}
        targetTaskId="router-1"
        tasks={[
          makeTask({ id: 'source-1', title: 'Source Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'data' }] }),
          makeTask({ id: 'router-1', title: 'Router Task', outputPorts: [{ id: 'done', name: 'Done', artifactKind: 'text' }] }),
          makeTask({ id: 'downstream-1', title: 'Downstream Task', outputPorts: [{ id: 'result', name: 'Result', artifactKind: 'data' }] }),
        ]}
      />,
    );

    expect(screen.getByRole('option', { name: 'Source Task' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Downstream Task' })).not.toBeInTheDocument();
  });
});
