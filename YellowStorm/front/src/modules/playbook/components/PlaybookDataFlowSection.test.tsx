import type React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookDataFlowSection } from './PlaybookDataFlowSection';
import type { Playbook } from '../types';
import { makePlaybook, makeTask } from '../test-utils';

const updateDataBindings = vi.fn();
function createPlaybook(dataBindings: Playbook['dataBindings'] = []): Playbook {
  return makePlaybook({
    id: 'playbook-1',
    edges: [],
    tasks: [
      makeTask({
        id: 'task-1',
        title: 'Convert Excel to PDF',
        inputPorts: [{ id: 'input_file', name: 'Source File', artifactKind: 'document', required: true }],
        outputPorts: [],
      }),
    ],
    dataBindings,
  });
}

const storeState: { currentPlaybook: Playbook } = {
  currentPlaybook: createPlaybook(),
};

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../store', () => ({
  useCurrentPlaybook: () => storeState.currentPlaybook,
  usePlaybookStore: (selector: (state: { updateDataBindings: typeof updateDataBindings }) => unknown) =>
    selector({ updateDataBindings }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

describe('PlaybookDataFlowSection', () => {
  beforeEach(() => {
    updateDataBindings.mockClear();
    storeState.currentPlaybook = createPlaybook();
  });

  it('shows selected document constant labels in the source column', () => {
    storeState.currentPlaybook = createPlaybook([{
      id: 'binding-1',
      targetNode: 'task-1',
      targetPort: 'input_file',
      sourceKind: 'constant',
      constantValue: {
        kind: 'document',
        id: 'doc-1',
        documentId: 'doc-1',
        workspaceId: 'workspace-1',
        workspaceName: 'ClientTest',
        label: 'jeu_donnees_workflow_copilote_ia.xlsx',
        path: '/clienttest/jeu_donnees_workflow_copilote_ia.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    }]);

    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    expect(screen.getByText('jeu_donnees_workflow_copilote_ia.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('dataFlow.constantValue')).not.toBeInTheDocument();
  });

  it('falls back to workspace names for workspace constants', () => {
    storeState.currentPlaybook = createPlaybook([{
      id: 'binding-1',
      targetNode: 'task-1',
      targetPort: 'input_file',
      sourceKind: 'constant',
      constantValue: {
        kind: 'workspace',
        id: 'workspace-1',
        workspaceId: 'workspace-1',
        workspaceName: 'ClientTest',
      },
    }]);

    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    expect(screen.getByText('ClientTest')).toBeInTheDocument();
  });

  it('renders selected resource constant arrays without generic labels', () => {
    storeState.currentPlaybook = createPlaybook([{
      id: 'binding-1',
      targetNode: 'task-1',
      targetPort: 'input_file',
      sourceKind: 'constant',
      constantValue: [
        { kind: 'document', id: 'doc-1', workspaceId: 'workspace-1', label: 'A.xlsx' },
        { kind: 'document', id: 'doc-2', workspaceId: 'workspace-1', label: 'B.xlsx' },
      ],
    }]);

    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    expect(screen.getByText('A.xlsx, B.xlsx')).toBeInTheDocument();
  });

  it('preserves structured constants when applying an unchanged displayed label', () => {
    const constantValue = {
      kind: 'document',
      id: 'doc-1',
      documentId: 'doc-1',
      workspaceId: 'workspace-1',
      label: 'A.xlsx',
      path: '/clienttest/A.xlsx',
    };
    storeState.currentPlaybook = createPlaybook([{
      id: 'binding-1',
      targetNode: 'task-1',
      targetPort: 'input_file',
      sourceKind: 'constant',
      constantValue,
    }]);

    render(<PlaybookDataFlowSection targetNodeId="task-1" />);
    fireEvent.click(screen.getByTitle('dataFlow.changeSource'));
    fireEvent.click(screen.getAllByText('dataFlow.apply')[0]);

    expect(updateDataBindings).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'binding-1',
        constantValue,
      }),
    ]);
  });

  it('stores a newly entered constant value on the created binding', () => {
    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    fireEvent.click(screen.getByText('dataFlow.connectSource'));
    fireEvent.change(screen.getByPlaceholderText('dataFlow.constantPlaceholder'), { target: { value: 'RUN_RAW' } });
    fireEvent.click(screen.getAllByText('dataFlow.apply')[0]);

    expect(updateDataBindings).toHaveBeenCalledWith([
      expect.objectContaining({
        targetNode: 'task-1',
        targetPort: 'input_file',
        sourceKind: 'constant',
        constantValue: { text: 'RUN_RAW' },
      }),
    ]);
  });

  it('keeps an existing constant binding when applying an emptied constant input', () => {
    storeState.currentPlaybook = createPlaybook([{
      id: 'binding-1',
      targetNode: 'task-1',
      targetPort: 'input_file',
      sourceKind: 'constant',
      constantValue: { kind: 'document', id: 'doc-1', label: 'A.xlsx' },
    }]);

    render(<PlaybookDataFlowSection targetNodeId="task-1" />);
    fireEvent.click(screen.getByTitle('dataFlow.changeSource'));
    fireEvent.change(screen.getByPlaceholderText('dataFlow.constantPlaceholder'), { target: { value: '' } });
    fireEvent.click(screen.getAllByText('dataFlow.apply')[0]);

    expect(updateDataBindings).not.toHaveBeenCalled();
  });

  it('keeps an existing constant binding when applying a whitespace-only constant input', () => {
    storeState.currentPlaybook = createPlaybook([{
      id: 'binding-1',
      targetNode: 'task-1',
      targetPort: 'input_file',
      sourceKind: 'constant',
      constantValue: { kind: 'document', id: 'doc-1', label: 'A.xlsx' },
    }]);

    render(<PlaybookDataFlowSection targetNodeId="task-1" />);
    fireEvent.click(screen.getByTitle('dataFlow.changeSource'));
    fireEvent.change(screen.getByPlaceholderText('dataFlow.constantPlaceholder'), { target: { value: '   ' } });
    fireEvent.click(screen.getAllByText('dataFlow.apply')[0]);

    expect(updateDataBindings).not.toHaveBeenCalled();
  });

  it('does not create a constant binding when applying an empty value', () => {
    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    fireEvent.click(screen.getByText('dataFlow.connectSource'));
    fireEvent.click(screen.getAllByText('dataFlow.apply')[0]);

    expect(updateDataBindings).not.toHaveBeenCalled();
  });

  it('does not create a constant binding when applying a whitespace-only value', () => {
    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    fireEvent.click(screen.getByText('dataFlow.connectSource'));
    fireEvent.change(screen.getByPlaceholderText('dataFlow.constantPlaceholder'), { target: { value: '   ' } });
    fireEvent.click(screen.getAllByText('dataFlow.apply')[0]);

    expect(updateDataBindings).not.toHaveBeenCalled();
  });

  it('does not create an expression binding when applying an empty expression', () => {
    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    fireEvent.click(screen.getByText('dataFlow.connectSource'));
    fireEvent.click(screen.getAllByText('dataFlow.apply')[1]);

    expect(updateDataBindings).not.toHaveBeenCalled();
  });

  it('does not create a trigger binding when applying an empty path', () => {
    render(<PlaybookDataFlowSection targetNodeId="task-1" />);

    fireEvent.click(screen.getByText('dataFlow.connectSource'));
    fireEvent.click(screen.getAllByText('dataFlow.apply')[2]);

    expect(updateDataBindings).not.toHaveBeenCalled();
  });

  it('adds iterator context input ports while keeping the collection port locked', () => {
    const onInputPortsChange = vi.fn();

    render(
      <PlaybookDataFlowSection
        targetNodeId="task-1"
        inputPortsOverride={[{ id: 'items', name: 'Items', artifactKind: 'data', required: false, role: 'collection' }]}
        outputPortsOverride={[{ id: 'results', name: 'Results', artifactKind: 'data' }]}
        onInputPortsChange={onInputPortsChange}
        canEditPorts
        inputPortBehavior="iterator"
        showOutputPorts
        canEditOutputPortNames={false}
        canEditOutputPortKinds={false}
        canModifyOutputPorts={false}
      />,
    );

    expect(screen.getByDisplayValue('Items')).toBeDisabled();

    fireEvent.click(screen.getByText('dataFlow.addInput'));

    expect(onInputPortsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'items', role: 'collection' }),
      expect.objectContaining({ role: 'context', artifactKind: 'text', required: false }),
    ]);
  });
});
