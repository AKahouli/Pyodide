import { describe, expect, it } from 'vitest';
import { controlEdgesToFlowEdges, edgeMatchesIntentPortPair, playbookEdgesToFlowEdges, resolveIntentEdgePorts } from './control-edge-serializer';
import type { ControlEdge, PlaybookEdge, PlaybookTask } from '../../types';

describe('playbookEdgesToFlowEdges', () => {
  it('preserves explicit iterator context input ports', () => {
    const edges: PlaybookEdge[] = [{
      id: 'edge-template',
      sourceId: 'loader',
      targetId: 'iterator',
      sourceOutputPortId: 'output_2',
      targetInputPortId: 'template_doc',
    }];
    const tasks = [
      {
        id: 'loader',
        outputPorts: [{ id: 'output_2', name: 'Generated document', artifactKind: 'document' }],
      },
      {
        id: 'iterator',
        nodeType: 'iterator',
        inputPorts: [
          { id: 'items', name: 'Items', artifactKind: 'data', required: false },
          { id: 'template_doc', name: 'Template Document', artifactKind: 'document', required: false },
        ],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      },
    ] as PlaybookTask[];

    const [edge] = playbookEdgesToFlowEdges(edges, tasks);

    expect(edge.targetHandle).toBe('template_doc');
    expect(edge.data).toEqual(expect.objectContaining({ targetInputPortId: 'template_doc' }));
  });

  it('falls back legacy iterator edges to canonical collection and result ports', () => {
    const edges: PlaybookEdge[] = [{
      id: 'edge-legacy',
      sourceId: 'source-iterator',
      targetId: 'target-iterator',
      sourceOutputPortId: 'default',
      targetInputPortId: 'default',
    }];
    const tasks = [
      {
        id: 'source-iterator',
        nodeType: 'iterator',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      },
      {
        id: 'target-iterator',
        nodeType: 'iterator',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      },
    ] as PlaybookTask[];

    const [edge] = playbookEdgesToFlowEdges(edges, tasks);

    expect(edge.sourceHandle).toBe('results');
    expect(edge.targetHandle).toBe('items');
    expect(edge.data).toEqual(expect.objectContaining({
      sourceOutputPortId: 'results',
      targetInputPortId: 'items',
    }));
  });
});

describe('controlEdgesToFlowEdges', () => {
  it('applies router conditional edges with labels and handles preserved', () => {
    const edges: ControlEdge[] = [{
      id: 'route-approved',
      kind: 'conditional',
      source: 'router-1',
      target: 'approved-step',
      routerLabel: 'approved',
      sourceOutputPortId: 'approved',
      targetInputPortId: 'payload',
      priority: 1,
    }];

    expect(controlEdgesToFlowEdges(edges)[0]).toEqual(expect.objectContaining({
      id: 'route-approved',
      source: 'router-1',
      target: 'approved-step',
      sourceHandle: 'approved',
      targetHandle: 'payload',
      type: 'conditional',
      animated: false,
      data: expect.objectContaining({
        kind: 'conditional',
        routerLabel: 'approved',
        sourceOutputPortId: 'approved',
        targetInputPortId: 'payload',
        priority: 1,
      }),
    }));
  });

  it('keeps router branches distinct by router label', () => {
    const route = { sourceId: 'router-1', targetId: 'target-1', sourceOutputPortId: 'approved', targetInputPortId: 'payload', routerLabel: 'approved' };

    expect(edgeMatchesIntentPortPair(route, 'router-1', 'target-1', 'approved', 'payload', 'approved')).toBe(true);
    expect(edgeMatchesIntentPortPair(route, 'router-1', 'target-1', 'approved', 'payload', 'rejected')).toBe(false);
  });
});

describe('resolveIntentEdgePorts', () => {
  it('preserves exact requested ports for visual edges when artifact kinds differ', () => {
    const sourceTask = {
      id: 'collect_rh_cvs',
      outputPorts: [{ id: 'output-1', name: 'CV file references', artifactKind: 'text' }],
    } as PlaybookTask;
    const targetTask = {
      id: 'reformat_cvs',
      nodeType: 'iterator',
      inputPorts: [{ id: 'items', name: 'CV items', artifactKind: 'data', required: false }],
    } as PlaybookTask;

    expect(resolveIntentEdgePorts(sourceTask, targetTask, 'output-1', 'items')).toEqual({
      sourceOutputPortId: 'output-1',
      targetInputPortId: 'items',
    });
  });

  it('uses the requested router output port instead of the first compatible output', () => {
    const sourceTask = {
      id: 'classify_file',
      nodeType: 'router',
      outputPorts: [
        { id: 'word_file', name: 'Word File', artifactKind: 'data' },
        { id: 'excel_file', name: 'Excel File', artifactKind: 'data' },
        { id: 'pptx_file', name: 'PowerPoint File', artifactKind: 'data' },
      ],
    } as PlaybookTask;
    const targetTask = {
      id: 'generate_excel_doc',
      inputPorts: [{ id: 'input-data', name: 'File Data', artifactKind: 'data', required: true }],
    } as PlaybookTask;

    expect(resolveIntentEdgePorts(sourceTask, targetTask, 'excel_file', null)).toEqual({
      sourceOutputPortId: 'excel_file',
      targetInputPortId: 'input-data',
    });
  });

  it('preserves iterator router output labels when resolving child conditional edges', () => {
    const routerStep = {
      id: 'iterator.file_router',
      nodeType: 'router',
      outputPorts: [
        { id: 'docx', name: 'DOCX', artifactKind: 'data' },
        { id: 'pdf', name: 'PDF', artifactKind: 'data' },
      ],
    } as PlaybookTask;
    const childStep = {
      id: 'iterator.pdf_step',
      inputPorts: [{ id: 'file', name: 'File', artifactKind: 'data', required: true }],
    } as PlaybookTask;

    expect(resolveIntentEdgePorts(routerStep, childStep, 'pdf', 'file')).toEqual({
      sourceOutputPortId: 'pdf',
      targetInputPortId: 'file',
    });
  });

  it('matches backend text-serializable kinds when resolving generated topology links', () => {
    const detectStep = {
      id: 'iterator.detect_extension',
      outputPorts: [{ id: 'output_data', name: 'Metadata', artifactKind: 'data' }],
    } as PlaybookTask;
    const routerStep = {
      id: 'iterator.route_by_extension',
      nodeType: 'router',
      inputPorts: [{ id: 'input_1', name: 'Extension Input', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'pdf', name: 'PDF', artifactKind: 'text' }],
    } as PlaybookTask;
    const handlerStep = {
      id: 'iterator.handle_pdf',
      inputPorts: [{ id: 'input_data', name: 'PDF File', artifactKind: 'data', required: false }],
    } as PlaybookTask;

    expect(resolveIntentEdgePorts(detectStep, routerStep, null, null)).toEqual({
      sourceOutputPortId: 'output_data',
      targetInputPortId: 'input_1',
    });
    expect(resolveIntentEdgePorts(routerStep, handlerStep, 'pdf', null)).toEqual({
      sourceOutputPortId: 'pdf',
      targetInputPortId: 'input_data',
    });
  });
});
