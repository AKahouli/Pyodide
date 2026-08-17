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
    {
      key: 'iterator-template',
      nodeType: 'iterator',
      enabled: true,
      recommendedAgentTypeSlug: null,
      iteratorConfig: { source: 'items', mode: 'item' },
      inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: true }],
      outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
    },
    {
      key: 'generic-step',
      nodeType: 'agent',
      enabled: true,
      recommendedAgentTypeSlug: null,
      inputPorts: [],
      outputPorts: [],
    },
    {
      key: 'context-step',
      nodeType: 'agent',
      enabled: true,
      recommendedAgentTypeSlug: null,
      inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'data', required: true }],
      outputPorts: [],
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

  it('binds a unique required blueprint port on an iterator body entry step to the current item', () => {
    const result = repair({
      title: 'Iterate',
      summary: 'Iterate',
      nodes: [{
        ref: 'iterator',
        label: 'Iterator',
        purpose: 'Iterate',
        nodeTemplateKey: 'iterator-template',
        inputPorts: [{ id: 'items', artifactKind: 'data', required: true }],
        iteratorBody: {
          steps: [{
            ref: 'extract',
            title: 'Extract',
            nodeTemplateKey: 'generic-step',
            inputPorts: [{ id: 'current-cv', name: 'CV courant', artifactKind: 'data', required: true }],
          }],
          edges: [],
        },
      }],
      links: [],
    });

    expect(result.blueprint.bindings).toContainEqual({
      sourceKind: 'state',
      statePath: 'inputs._item',
      targetIteratorRef: 'iterator',
      targetRef: 'extract',
      targetPort: 'current-cv',
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'repair_iterator_current_item_binding_added',
      itemId: 'extract',
      severity: 'info',
    }));
    expect(result.repairSummary).toContain('Bound iterator current item to extract.current-cv.');
  });

  it('preserves explicit bindings and port-aware links targeting iterator entry inputs', () => {
    const result = repair({
      title: 'Iterate',
      summary: 'Iterate',
      nodes: [{
        ref: 'iterator',
        label: 'Iterator',
        purpose: 'Iterate',
        nodeTemplateKey: 'iterator-template',
        inputPorts: [{ id: 'items', artifactKind: 'data', required: true }],
        iteratorBody: {
          steps: [
            { ref: 'bound', title: 'Bound', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'item', artifactKind: 'data', required: true }] },
            { ref: 'linked', title: 'Linked', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'item', artifactKind: 'data', required: true }] },
          ],
          edges: [],
        },
      }, {
        ref: 'source',
        label: 'Source',
        purpose: 'Source',
        nodeTemplateKey: 'generic-step',
        outputPorts: [{ id: 'data', artifactKind: 'data' }],
      }],
      links: [{ sourceRef: 'source', targetIteratorRef: 'iterator', targetRef: 'linked', sourceOutputPortId: 'data', targetInputPortId: 'item' }],
      bindings: [{ sourceKind: 'constant', constantValue: { id: 1 }, targetIteratorRef: 'iterator', targetRef: 'bound', targetPort: 'item' }],
    });

    expect(result.blueprint.bindings).toHaveLength(1);
    expect(result.blueprint.bindings?.[0]).toEqual(expect.objectContaining({ sourceKind: 'constant', targetRef: 'bound' }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'repair_iterator_current_item_binding_added' }));
  });

  it('does not guess when current-item targets are ambiguous or incompatible', () => {
    const result = repair({
      title: 'Iterate',
      summary: 'Iterate',
      nodes: [{
        ref: 'iterator',
        label: 'Iterator',
        purpose: 'Iterate',
        nodeTemplateKey: 'iterator-template',
        inputPorts: [{ id: 'items', artifactKind: 'data', required: true }],
        iteratorBody: {
          steps: [
            {
              ref: 'ambiguous',
              title: 'Ambiguous',
              nodeTemplateKey: 'generic-step',
              inputPorts: [
                { id: 'first', artifactKind: 'data', required: true },
                { id: 'second', artifactKind: 'data', required: true },
              ],
            },
            {
              ref: 'incompatible',
              title: 'Incompatible',
              nodeTemplateKey: 'generic-step',
              inputPorts: [{ id: 'image', artifactKind: 'image', required: true }],
            },
          ],
          edges: [],
        },
      }],
      links: [],
    });

    expect(result.blueprint.bindings).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'repair_iterator_current_item_target_ambiguous',
        metadata: expect.objectContaining({ candidatePortIds: ['first', 'second'] }),
      }),
      expect.objectContaining({
        code: 'repair_iterator_current_item_target_incompatible',
        metadata: expect.objectContaining({ candidatePortIds: ['image'] }),
      }),
    ]));
  });

  it('does not bind optional, template-owned, or non-entry inputs', () => {
    const result = repair({
      title: 'Iterate',
      summary: 'Iterate',
      nodes: [{
        ref: 'iterator',
        label: 'Iterator',
        purpose: 'Iterate',
        nodeTemplateKey: 'iterator-template',
        inputPorts: [{ id: 'items', artifactKind: 'data', required: true }],
        iteratorBody: {
          steps: [
            { ref: 'optional', title: 'Optional', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'item', artifactKind: 'data' }] },
            { ref: 'template-owned', title: 'Context', nodeTemplateKey: 'context-step', inputPorts: [{ id: 'context', artifactKind: 'data', required: true }] },
            { ref: 'entry', title: 'Entry', nodeTemplateKey: 'generic-step' },
            { ref: 'downstream', title: 'Downstream', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'item', artifactKind: 'data', required: true }] },
          ],
          edges: [{ sourceRef: 'entry', targetRef: 'downstream' }],
        },
      }],
      links: [],
    });

    expect(result.blueprint.bindings).toBeUndefined();
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'repair_iterator_current_item_binding_added' }));
  });
});
