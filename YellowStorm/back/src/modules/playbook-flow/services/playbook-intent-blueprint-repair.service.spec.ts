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

  it('adopts router labels used by links but missing from routerConfig outputLabels', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route_leads',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: { outputLabels: ['fallback'] },
        outputPorts: [{ id: 'fallback', name: 'Fallback', artifactKind: 'data' }],
      }],
      links: [{ sourceRef: 'route_leads', targetRef: 'review', routerLabel: 'review_qualified_leads' }],
    });

    const node = result.blueprint.nodes[0];
    expect(node.routerConfig?.outputLabels).toContain('review_qualified_leads');
    expect(node.outputPorts).toContainEqual({ id: 'review_qualified_leads', name: 'review_qualified_leads', artifactKind: 'data' });
    expect(result.blueprint.links[0]).toEqual(expect.objectContaining({
      kind: 'conditional',
      sourceOutputPortId: 'review_qualified_leads',
    }));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'repair_router_label_adopted', itemId: 'route_leads->review', severity: 'info' }),
      expect.objectContaining({ code: 'repair_router_output_port_added', severity: 'info' }),
    ]));
  });

  it('materializes router config from the template when links use custom labels on a template-only router step', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'loop',
        label: 'Loop',
        purpose: 'Loop',
        nodeTemplateKey: 'iterator-template',
        inputPorts: [{ id: 'items', artifactKind: 'data', required: true }],
        iteratorBody: {
          steps: [{ ref: 'route_ticket', title: 'Route Ticket', nodeTemplateKey: 'router-template' }],
          edges: [{ sourceRef: 'route_ticket', targetRef: 'escalate', routerLabel: 'escalate_urgent' }],
        },
      }],
      links: [],
    });

    const step = result.blueprint.nodes[0].iteratorBody?.steps[0];
    expect(step?.primitive?.router?.outputLabels).toEqual(['fallback', 'escalate_urgent']);
    expect(step?.primitive?.router?.defaultLabel).toBe('fallback');
    expect(step?.outputPorts).toContainEqual({ id: 'escalate_urgent', name: 'escalate_urgent', artifactKind: 'data' });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'repair_router_config_materialized', itemId: 'route_ticket', severity: 'info' }),
      expect.objectContaining({ code: 'repair_router_label_adopted', itemId: 'loop.route_ticket->escalate', severity: 'info' }),
    ]));
  });

  it('infers a missing router label from a matching sourceOutputPortId', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route_invoice',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: { outputLabels: ['approve_invoice', 'reject_invoice'] },
      }],
      links: [
        { sourceRef: 'route_invoice', targetRef: 'approve', sourceOutputPortId: 'approve_invoice' },
        { sourceRef: 'route_invoice', targetRef: 'reject', sourceOutputPortId: 'reject_invoice' },
      ],
    });

    expect(result.blueprint.links[0].routerLabel).toBe('approve_invoice');
    expect(result.blueprint.links[1].routerLabel).toBe('reject_invoice');
    expect(result.blueprint.links[0]).toEqual(expect.objectContaining({ kind: 'conditional', sourceOutputPortId: 'approve_invoice' }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'repair_router_link_label_inferred',
      itemId: 'route_invoice->approve',
      severity: 'info',
    }));
  });

  it('infers the label on a single-label router and leaves multi-label routers alone', () => {
    const single = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: { outputLabels: ['only_branch'] },
      }],
      links: [{ sourceRef: 'route', targetRef: 'next' }],
    });
    expect(single.blueprint.links[0].routerLabel).toBe('only_branch');

    const multi = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: { outputLabels: ['a', 'b'] },
      }],
      links: [{ sourceRef: 'route', targetRef: 'next' }],
    });
    expect(multi.blueprint.links[0].routerLabel).toBeUndefined();
    expect(multi.diagnostics.some((diagnostic) => diagnostic.code === 'repair_router_link_label_inferred')).toBe(false);
  });

  it('does not adopt router labels when the link source has no router config', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{ ref: 'agent', label: 'Agent', purpose: 'Agent', nodeTemplateKey: 'generic-step' }],
      links: [{ sourceRef: 'agent', targetRef: 'next', routerLabel: 'stray_label' }],
    });

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'repair_router_label_adopted')).toBe(false);
    expect(result.blueprint.links[0].sourceOutputPortId).toBe('stray_label');
  });

  it('adopts router labels used by iterator body edges', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'loop',
        label: 'Loop',
        purpose: 'Loop',
        nodeTemplateKey: 'iterator-template',
        inputPorts: [{ id: 'items', artifactKind: 'data', required: true }],
        iteratorBody: {
          steps: [{
            ref: 'classify',
            title: 'Classify',
            nodeTemplateKey: 'router-template',
            primitive: { kind: 'router', router: { outputLabels: ['word_file'] } },
          }],
          edges: [{ sourceRef: 'classify', targetRef: 'pdf_step', routerLabel: 'pdf_file' }],
        },
      }],
      links: [],
    });

    const step = result.blueprint.nodes[0].iteratorBody?.steps[0];
    expect(step?.primitive?.router?.outputLabels).toEqual(['word_file', 'pdf_file']);
    expect(step?.outputPorts).toContainEqual({ id: 'pdf_file', name: 'pdf_file', artifactKind: 'data' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'repair_router_label_adopted',
      itemId: 'loop.classify->pdf_step',
      severity: 'info',
    }));
  });

  it('infers the default label when exactly one branch lacks a deterministic condition', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: {
          outputLabels: ['qualified', 'nurture'],
          conditions: [{ label: 'qualified', sourceRef: 'score', sourcePort: 'score', operator: 'gte', value: 0.8 }],
        },
        outputPorts: [],
      }],
      links: [],
    });

    expect(result.blueprint.nodes[0].routerConfig?.defaultLabel).toBe('nurture');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'repair_router_default_label_inferred',
      itemId: 'route',
      severity: 'info',
    }));
  });

  it('does not infer a default label when multiple branches lack conditions', () => {
    const result = repair({
      title: 'Test',
      summary: 'Test',
      nodes: [{
        ref: 'route',
        label: 'Route',
        purpose: 'Route',
        nodeTemplateKey: 'router-template',
        routerConfig: {
          outputLabels: ['qualified', 'nurture', 'escalate'],
          conditions: [{ label: 'qualified', sourceRef: 'score', sourcePort: 'score', operator: 'gte', value: 0.8 }],
        },
        outputPorts: [],
      }],
      links: [],
    });

    expect(result.blueprint.nodes[0].routerConfig?.defaultLabel).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'repair_router_default_label_inferred')).toBe(false);
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

  it('binds an unbound required input from the unique kind-matching sequential link source', () => {
    const result = repair({
      title: 'Flow',
      summary: 'Flow',
      nodes: [
        { ref: 'collect', label: 'Collect', purpose: 'Collect', nodeTemplateKey: 'generic-step', outputPorts: [{ id: 'records', artifactKind: 'data' }] },
        { ref: 'analyze', label: 'Analyze', purpose: 'Analyze', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'context', artifactKind: 'data', required: true }] },
      ],
      links: [{ sourceRef: 'collect', targetRef: 'analyze', sourceOutputPortId: 'records', targetInputPortId: 'other' }],
    });

    expect(result.blueprint.bindings).toContainEqual({
      targetRef: 'analyze',
      targetPort: 'context',
      sourceKind: 'node-output',
      sourceRef: 'collect',
      sourcePort: 'records',
    });
    expect(result.repairSummary).toContain('Bound required input analyze.context to collect.records.');
  });

  it('binds an unbound required input from a unique same-named same-kind output port', () => {
    const result = repair({
      title: 'Flow',
      summary: 'Flow',
      nodes: [
        { ref: 'score', label: 'Score', purpose: 'Score', nodeTemplateKey: 'generic-step', outputPorts: [{ id: 'scored_leads', artifactKind: 'data' }] },
        { ref: 'nurture', label: 'Nurture', purpose: 'Nurture', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'scored_leads', artifactKind: 'data', required: true }] },
      ],
      links: [],
    });

    expect(result.blueprint.bindings).toContainEqual({
      targetRef: 'nurture',
      targetPort: 'scored_leads',
      sourceKind: 'node-output',
      sourceRef: 'score',
      sourcePort: 'scored_leads',
    });
  });

  it('warns instead of guessing when no unique source can bind a required input', () => {
    const result = repair({
      title: 'Flow',
      summary: 'Flow',
      nodes: [
        { ref: 'score_a', label: 'Score A', purpose: 'Score', nodeTemplateKey: 'generic-step', outputPorts: [{ id: 'scored_leads', artifactKind: 'data' }] },
        { ref: 'score_b', label: 'Score B', purpose: 'Score', nodeTemplateKey: 'generic-step', outputPorts: [{ id: 'scored_leads', artifactKind: 'data' }] },
        { ref: 'nurture', label: 'Nurture', purpose: 'Nurture', nodeTemplateKey: 'generic-step', inputPorts: [{ id: 'scored_leads', artifactKind: 'data', required: true }] },
      ],
      links: [],
    });

    expect(result.blueprint.bindings).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'repair_required_port_binding_unresolved',
      path: 'nurture.scored_leads',
      severity: 'warning',
    }));
  });
});
