import { PlaybookIntentBlueprintParserService } from './playbook-intent-blueprint-parser.service';

describe('PlaybookIntentBlueprintParserService', () => {
  let service: PlaybookIntentBlueprintParserService;

  beforeEach(() => {
    service = new PlaybookIntentBlueprintParserService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('accepts a valid linear blueprint with linked nodes and bindings', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Research',
        summary: 'Linear research workflow',
        nodes: [
          { ref: 'collect', label: 'Collect', purpose: 'Gather data', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
          { ref: 'draft', label: 'Draft', purpose: 'Write report', nodeTemplateKey: 'synthesis-step',
            inputPorts: [{ id: 'data', artifactKind: 'data', required: true }],
            outputPorts: [{ id: 'report', artifactKind: 'document' }] },
        ],
        links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
        bindings: [{ sourceKind: 'node-output', sourceRef: 'collect', sourcePort: 'data', targetRef: 'draft', targetPort: 'data' }],
      },
    });

    const result = service.parse(raw);

    expect(result).not.toBeNull();
    expect(result!.blueprint.title).toBe('Research');
    expect(result!.blueprint.nodes).toHaveLength(2);
    expect(result!.blueprint.links).toHaveLength(1);
    expect(result!.blueprint.bindings).toHaveLength(1);
    expect(result!.diagnostics).toEqual([]);
  });

  it('accepts scoped iterator child links and bindings', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Iterator scoped',
        nodes: [
          { ref: 'template', label: 'Template', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'document', artifactKind: 'document' }] },
          {
            ref: 'loop', label: 'Loop', purpose: '', nodeTemplateKey: 'iterator.template',
            iteratorBody: {
              steps: [{ ref: 'child', title: 'Child', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'template', artifactKind: 'document' }] }],
              edges: [],
            },
          },
        ],
        links: [{ sourceRef: 'template', targetIteratorRef: 'loop', targetRef: 'child', sourceOutputPortId: 'document', targetInputPortId: 'template' }],
        bindings: [{ sourceKind: 'node-output', sourceRef: 'template', sourcePort: 'document', targetIteratorRef: 'loop', targetRef: 'child', targetPort: 'template' }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.links[0]).toEqual(expect.objectContaining({ targetIteratorRef: 'loop', targetRef: 'child' }));
    expect(result.blueprint.bindings?.[0]).toEqual(expect.objectContaining({ targetIteratorRef: 'loop', targetRef: 'child' }));
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts links where sourceIteratorRef equals sourceRef (iterator node itself as source)', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Self iterator ref',
        nodes: [
          {
            ref: 'loop', label: 'Loop', purpose: '', nodeTemplateKey: 'iterator.template',
            inputPorts: [{ id: 'items', artifactKind: 'data' }],
            outputPorts: [{ id: 'results', artifactKind: 'data' }],
            iteratorBody: {
              steps: [{ ref: 'child', title: 'Child', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'input', artifactKind: 'data' }], outputPorts: [{ id: 'output', artifactKind: 'data' }] }],
              edges: [],
            },
          },
          { ref: 'report', label: 'Report', purpose: '', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'context', artifactKind: 'text' }] },
        ],
        links: [{ sourceRef: 'loop', sourceIteratorRef: 'loop', targetRef: 'report', sourceOutputPortId: 'results', targetInputPortId: 'context' }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.links).toHaveLength(1);
    expect(result.diagnostics.filter((d) => d.code === 'blueprint_link_unknown_ref')).toEqual([]);
  });

  it('accepts connector and skill refs with slug-based snake_case fields', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Catalog refs',
        nodes: [{
          ref: 'search_files',
          label: 'Search files',
          purpose: 'Find source documents',
          nodeTemplateKey: 'generic.agent_step',
          connector_refs: [{ connector_slug: 'google-drive', action_key: 'search', reason: 'Find files' }],
          skill_refs: [{ skill_slug: 'summarize-documents', reason: 'Summarize matches' }],
        }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.nodes[0].connectorRefs).toEqual([
      { connectorSlug: 'google-drive', actionKey: 'search', reason: 'Find files' },
    ]);
    expect(result.blueprint.nodes[0].skillRefs).toEqual([
      { skillSlug: 'summarize-documents', reason: 'Summarize matches' },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('drops malformed connector and skill refs', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Bad refs',
        nodes: [{
          ref: 'search_files',
          label: 'Search files',
          nodeTemplateKey: 'generic.agent_step',
          connector_refs: [{ connector_slug: 'google-drive' }, { action_key: 'search' }],
          skill_refs: [{}],
        }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.nodes[0].connectorRefs).toEqual([]);
    expect(result.blueprint.nodes[0].skillRefs).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'blueprint_connector_ref_missing_fields',
      'blueprint_skill_ref_missing_fields',
    ]));
  });

  it('accepts camelCase refs and drops duplicates per node', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Catalog refs',
        nodes: [{
          ref: 'search_files',
          label: 'Search files',
          purpose: 'Find source documents',
          nodeTemplateKey: 'generic.agent_step',
          connectorRefs: [
            { connectorSlug: 'google-drive', actionKey: 'search' },
            { connectorSlug: 'google-drive', actionKey: 'search' },
          ],
          skillRefs: [
            { skillSlug: 'summarize-documents' },
            { skillSlug: 'summarize-documents' },
          ],
        }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.nodes[0].connectorRefs).toEqual([
      { connectorSlug: 'google-drive', actionKey: 'search', reason: null },
    ]);
    expect(result.blueprint.nodes[0].skillRefs).toEqual([
      { skillSlug: 'summarize-documents', reason: null },
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'blueprint_connector_ref_duplicate',
      'blueprint_skill_ref_duplicate',
    ]));
  });

  it('returns null for malformed JSON', () => {
    expect(service.parse('not-json')).toBeNull();
  });

  it('accepts markdown-fenced blueprint JSON', () => {
    const raw = ['```json', JSON.stringify({ blueprint: { title: 'Plan', summary: '', nodes: [] } }), '```'].join('\n');

    const result = service.parse(raw);

    expect(result?.blueprint.title).toBe('Plan');
    expect(service.hasBlueprintShape(raw)).toBe(true);
  });

  it('accepts blueprint JSON wrapped in prose', () => {
    const raw = `Here is the blueprint:\n${JSON.stringify({ blueprint: { title: 'Wrapped', summary: '', nodes: [] } })}\nDone.`;

    const result = service.parse(raw);

    expect(result?.blueprint.title).toBe('Wrapped');
    expect(service.hasBlueprintShape(raw)).toBe(true);
  });

  it('rejects legacy templateType when nodeTemplateKey is missing', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Legacy template',
        nodes: [{ ref: 'legacy_step', label: 'Legacy step', templateType: 'legacy.template' }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.nodes).toEqual([]);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_node_missing_fields')).toMatchObject({ stage: 'parser', severity: 'warning' });
    expect((service as any).logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('playbook_intent_blueprint_legacy_template_type'));
  });

  it('derives a missing blueprint title from the first node label', () => {
    const raw = JSON.stringify({
      blueprint: {
        nodes: [{ ref: 'collect_input', label: 'Collect input', purpose: 'Collect source input', nodeTemplateKey: 'generic.agent_step' }],
      },
    });

    const result = service.parse(raw);

    expect(result?.blueprint.title).toBe('Collect input');
  });

  it('returns null when blueprint key is absent', () => {
    expect(service.parse(JSON.stringify({ suggestions: [] }))).toBeNull();
  });

  it('returns null when no title can be derived', () => {
    const raw = JSON.stringify({ blueprint: { nodes: [] } });
    expect(service.parse(raw)).toBeNull();
  });

  it('drops nodes missing required ref or label', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A', nodeTemplateKey: 'generic.agent_step' },
          { ref: '', label: 'B', nodeTemplateKey: 'generic.agent_step' },
          { ref: 'c', nodeTemplateKey: 'generic.agent_step' },
          { label: 'D' },
        ],
      },
    });

    const result = service.parse(raw)!;
    expect(result.blueprint.nodes.map((n) => n.ref)).toEqual(['a']);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_node_missing_fields')).toMatchObject({ stage: 'parser', severity: 'warning' });
  });

  it('drops duplicate node refs and keeps the first occurrence', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A', nodeTemplateKey: 'generic.agent_step' },
          { ref: 'a', label: 'A duplicate', nodeTemplateKey: 'generic.agent_step' },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.nodes).toHaveLength(1);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_node_duplicate_ref')).toMatchObject({ stage: 'parser', severity: 'warning' });
  });

  it('does not carry blueprint nodeType into parsed output', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [{ ref: 'a', label: 'A', nodeTemplateKey: 'generic.agent_step', nodeType: 'unknown_kind' }],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.nodes).toHaveLength(1);
    expect(result.blueprint.nodes[0]).not.toHaveProperty('nodeType');
    expect(result.diagnostics.find((d) => d.code === 'blueprint_node_unsupported_kind')).toBeUndefined();
  });

  it('keeps the iterator body scoped to its owning node and rejects unknown step refs', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [{
          ref: 'loop', label: 'Loop', purpose: 'Iterate', nodeTemplateKey: 'iterator.template',
          iteratorBody: {
            steps: [
              { ref: 's1', title: 'Step 1', nodeTemplateKey: 'generic.agent_step' },
              { ref: 's2', title: 'Step 2', nodeTemplateKey: 'generic.agent_step' },
            ],
            edges: [
              { sourceRef: 's1', targetRef: 's2' },
              { sourceRef: 's1', targetRef: 'unknown', sourceOutputPortId: 'out', targetInputPortId: 'in' },
            ],
          },
        }],
      },
    });
    const result = service.parse(raw)!;
    const body = result.blueprint.nodes[0].iteratorBody!;
    expect(body.steps).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_iterator_edge_unknown_ref')).toMatchObject({ stage: 'parser', severity: 'warning' });
  });

  it('drops malformed links and rejects refs that point to unknown nodes', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [{ ref: 'a', label: 'A', nodeTemplateKey: 'generic.agent_step' }],
        links: [
          { sourceRef: 'a', targetRef: 'b' },
          { sourceRef: 'a', targetRef: '' },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.links).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['blueprint_link_unknown_ref', 'blueprint_link_missing_refs']),
    );
  });

  it('accepts constant workspace and document bindings and rejects malformed constant values', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'dst_a', label: 'Destination A', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'inp', artifactKind: 'text' }] },
          { ref: 'dst_b', label: 'Destination B', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'inp', artifactKind: 'text' }] },
          { ref: 'dst_c', label: 'Destination C', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'inp', artifactKind: 'text' }] },
        ],
        bindings: [
          { sourceKind: 'constant', targetRef: 'dst_a', targetPort: 'inp',
            constantValue: { kind: 'document', id: 'doc-1', workspaceId: 'ws-1', documentId: 'doc-1', label: 'Invoice' } },
          { sourceKind: 'constant', targetRef: 'dst_b', targetPort: 'inp',
            constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1', label: 'Finance' } },
          { sourceKind: 'constant', targetRef: 'dst_c', targetPort: 'inp',
            constantValue: { kind: 'document', id: 'doc-2' } },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.bindings).toHaveLength(2);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_binding_invalid_constant')).toMatchObject({ stage: 'parser', severity: 'warning' });
  });

  it('drops duplicate bindings targeting the same port on a node', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
          { ref: 'b', label: 'B', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'i', artifactKind: 'text' }] },
        ],
        bindings: [
          { sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o', targetRef: 'b', targetPort: 'i' },
          { sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o', targetRef: 'b', targetPort: 'i' },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.bindings).toHaveLength(1);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_binding_duplicate_target')).toMatchObject({ stage: 'parser', severity: 'warning' });
  });

  it('drops bindings with mismatched artifact kinds', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
          { ref: 'b', label: 'B', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'i', artifactKind: 'document' }] },
        ],
        bindings: [{ sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o', targetRef: 'b', targetPort: 'i' }],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.bindings).toHaveLength(0);
    expect(result.diagnostics.find((d) => d.code === 'blueprint_binding_artifact_mismatch')).toMatchObject({ stage: 'parser', severity: 'warning' });
  });

  it('hasBlueprintShape returns true only when blueprint key is present', () => {
    expect(service.hasBlueprintShape(JSON.stringify({ blueprint: {} }))).toBe(true);
    expect(service.hasBlueprintShape(JSON.stringify({ suggestions: [] }))).toBe(false);
    expect(service.hasBlueprintShape('not-json')).toBe(false);
    expect(service.hasBlueprintShape(null)).toBe(false);
  });
});
