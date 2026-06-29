import { PlaybookIntentBlueprintRepairService } from './playbook-intent-blueprint-repair.service';
import type { PlaybookIntentBlueprint } from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { BuilderNodeTemplate } from './playbook-intent-graph-builder.service';
import type { IntentWorkflowValidationContext } from './playbook-flow-intent.service';

describe('PlaybookIntentBlueprintRepairService', () => {
  const service = new PlaybookIntentBlueprintRepairService();
  const context: IntentWorkflowValidationContext = {
    existingTaskIds: new Set(),
    existingTaskTitles: new Map(),
    existingTaskAgents: new Map(),
    inputPortsByTaskId: new Map(),
    outputPortsByTaskId: new Map(),
    existingBindingTargets: new Set(),
  };

  const templates: BuilderNodeTemplate[] = [
    {
      key: 'router-template',
      nodeType: 'router',
      enabled: true,
      recommendedAgentTypeSlug: null,
      inputPorts: [{ id: 'input-1', name: 'Input', artifactKind: 'data', required: true }],
      outputPorts: [{ id: 'fallback', name: 'Fallback', artifactKind: 'data', required: true }],
      routerConfig: { outputLabels: ['fallback'], defaultLabel: 'fallback' },
    },
  ];

  function repair(blueprint: PlaybookIntentBlueprint) {
    return service.repair({ blueprint, templates, designCatalog: {}, existingContext: context });
  }

  it('adds missing required template ports and reports repairs', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{ ref: 'route', label: 'Route', purpose: 'Route', nodeTemplateKey: 'router-template', inputPorts: [], outputPorts: [] }],
      links: [],
    });

    expect(result.blueprint.nodes[0].inputPorts).toContainEqual(expect.objectContaining({ id: 'input-1', required: true }));
    expect(result.blueprint.nodes[0].outputPorts).toContainEqual(expect.objectContaining({ id: 'fallback', required: true }));
    expect(result.repairSummary).toEqual(expect.arrayContaining([
      expect.stringContaining('Added missing required template port input-1'),
      expect.stringContaining('Added missing required template port fallback'),
    ]));
    expect(result.diagnostics.every((diagnostic) => diagnostic.stage === 'repair')).toBe(true);
  });

  it('adds router output ports, deduplicates labels, and applies compatible template default labels', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: { outputLabels: ['fallback', 'excel_file', 'excel_file'] },
        outputPorts: [{ id: 'fallback', name: 'Fallback', artifactKind: 'data' }],
      }],
      links: [],
    });

    const node = result.blueprint.nodes[0];
    expect(node.routerConfig?.outputLabels).toEqual(['fallback', 'excel_file']);
    expect(node.routerConfig?.defaultLabel).toBe('fallback');
    expect(node.outputPorts).toContainEqual({ id: 'excel_file', name: 'excel_file', artifactKind: 'data' });
    expect(result.repairSummary).toEqual(expect.arrayContaining([
      expect.stringContaining('Deduplicated router output labels'),
      expect.stringContaining('Added router output port excel_file'),
      expect.stringContaining('Applied router default label fallback'),
    ]));
  });

  it('normalizes conditional router links without inventing targets or criteria', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [],
      links: [{ sourceRef: 'route', targetRef: 'excel', routerLabel: 'excel_file' }],
    });

    expect(result.blueprint.links[0]).toEqual(expect.objectContaining({
      kind: 'conditional',
      sourceOutputPortId: 'excel_file',
      sourceRef: 'route',
      targetRef: 'excel',
    }));
  });

  it('repairs iterator body router steps and edges', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'loop',
        label: 'Loop',
        purpose: 'Loop',
        nodeTemplateKey: 'unknown',
        iteratorBody: {
          steps: [{
            ref: 'classify',
            title: 'Classify',
            nodeTemplateKey: 'router-template',
            primitive: { kind: 'router', router: { outputLabels: ['word_file'] } },
          }],
          edges: [{ sourceRef: 'classify', targetRef: 'word_step', routerLabel: 'word_file' }],
        },
      }],
      links: [],
    });

    const step = result.blueprint.nodes[0].iteratorBody?.steps[0];
    const edge = result.blueprint.nodes[0].iteratorBody?.edges[0];
    expect(step?.outputPorts).toContainEqual({ id: 'word_file', name: 'word_file', artifactKind: 'data' });
    expect(edge).toEqual(expect.objectContaining({ kind: 'conditional', sourceOutputPortId: 'word_file' }));
  });

  it('deduplicates ports by id while preserving required=true', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'node',
        label: 'Node',
        purpose: 'Node',
        nodeTemplateKey: 'unknown',
        inputPorts: [
          { id: 'input-data', name: 'A', artifactKind: 'data' },
          { id: 'input-data', name: 'B', artifactKind: 'data', required: true },
        ],
      }],
      links: [],
    });

    expect(result.blueprint.nodes[0].inputPorts).toEqual([{ id: 'input-data', name: 'A', artifactKind: 'data', required: true }]);
  });
});
