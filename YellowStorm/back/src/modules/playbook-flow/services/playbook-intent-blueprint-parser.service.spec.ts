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
          { ref: 'collect', label: 'Collect', purpose: 'Gather data', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
          { ref: 'draft', label: 'Draft', purpose: 'Write report', templateType: 'synthesis-step',
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
    expect(result!.dropped).toEqual([]);
  });

  it('accepts connector and skill refs with slug-based snake_case fields', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Catalog refs',
        nodes: [{
          ref: 'search_files',
          label: 'Search files',
          purpose: 'Find source documents',
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
    expect(result.dropped).toEqual([]);
  });

  it('drops malformed connector and skill refs', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 'Bad refs',
        nodes: [{
          ref: 'search_files',
          label: 'Search files',
          connector_refs: [{ connector_slug: 'google-drive' }, { action_key: 'search' }],
          skill_refs: [{}],
        }],
      },
    });

    const result = service.parse(raw)!;

    expect(result.blueprint.nodes[0].connectorRefs).toEqual([]);
    expect(result.blueprint.nodes[0].skillRefs).toEqual([]);
    expect(result.dropped.map((drop) => drop.rule)).toEqual(expect.arrayContaining([
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
    expect(result.dropped.map((drop) => drop.rule)).toEqual(expect.arrayContaining([
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

  it('derives a missing blueprint title from the first node label', () => {
    const raw = JSON.stringify({
      blueprint: {
        nodes: [{ ref: 'collect_input', label: 'Collect input', purpose: 'Collect source input' }],
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
          { ref: 'a', label: 'A' },
          { ref: '', label: 'B' },
          { ref: 'c' },
          { label: 'D' },
        ],
      },
    });

    const result = service.parse(raw)!;
    expect(result.blueprint.nodes.map((n) => n.ref)).toEqual(['a']);
    expect(result.dropped.find((d) => d.rule === 'blueprint_node_missing_fields')).toBeDefined();
  });

  it('drops duplicate node refs and keeps the first occurrence', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A' },
          { ref: 'a', label: 'A duplicate' },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.nodes).toHaveLength(1);
    expect(result.dropped.find((d) => d.rule === 'blueprint_node_duplicate_ref')).toBeDefined();
  });

  it('drops unsupported node kinds but keeps the node without that hint', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [{ ref: 'a', label: 'A', nodeType: 'unknown_kind' }],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.nodes).toHaveLength(1);
    expect(result.blueprint.nodes[0].nodeType).toBeUndefined();
    expect(result.dropped.find((d) => d.rule === 'blueprint_node_unsupported_kind')).toBeDefined();
  });

  it('keeps the iterator body scoped to its owning node and rejects unknown step refs', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [{
          ref: 'loop', label: 'Loop', purpose: 'Iterate', nodeType: 'iterator',
          iteratorBody: {
            steps: [
              { ref: 's1', title: 'Step 1' },
              { ref: 's2', title: 'Step 2' },
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
    expect(result.dropped.find((d) => d.rule === 'blueprint_iterator_edge_unknown_ref')).toBeDefined();
  });

  it('drops malformed links and rejects refs that point to unknown nodes', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [{ ref: 'a', label: 'A' }],
        links: [
          { sourceRef: 'a', targetRef: 'b' },
          { sourceRef: 'a', targetRef: '' },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.links).toHaveLength(0);
    expect(result.dropped.map((d) => d.rule)).toEqual(
      expect.arrayContaining(['blueprint_link_unknown_ref', 'blueprint_link_missing_refs']),
    );
  });

  it('accepts constant workspace and document bindings and rejects malformed constant values', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'dst_a', label: 'Destination A', inputPorts: [{ id: 'inp', artifactKind: 'text' }] },
          { ref: 'dst_b', label: 'Destination B', inputPorts: [{ id: 'inp', artifactKind: 'text' }] },
          { ref: 'dst_c', label: 'Destination C', inputPorts: [{ id: 'inp', artifactKind: 'text' }] },
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
    expect(result.dropped.find((d) => d.rule === 'blueprint_binding_invalid_constant')).toBeDefined();
  });

  it('drops duplicate bindings targeting the same port on a node', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
          { ref: 'b', label: 'B', inputPorts: [{ id: 'i', artifactKind: 'text' }] },
        ],
        bindings: [
          { sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o', targetRef: 'b', targetPort: 'i' },
          { sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o', targetRef: 'b', targetPort: 'i' },
        ],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.bindings).toHaveLength(1);
    expect(result.dropped.find((d) => d.rule === 'blueprint_binding_duplicate_target')).toBeDefined();
  });

  it('drops bindings with mismatched artifact kinds', () => {
    const raw = JSON.stringify({
      blueprint: {
        title: 't',
        nodes: [
          { ref: 'a', label: 'A', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
          { ref: 'b', label: 'B', inputPorts: [{ id: 'i', artifactKind: 'document' }] },
        ],
        bindings: [{ sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o', targetRef: 'b', targetPort: 'i' }],
      },
    });
    const result = service.parse(raw)!;
    expect(result.blueprint.bindings).toHaveLength(0);
    expect(result.dropped.find((d) => d.rule === 'blueprint_binding_artifact_mismatch')).toBeDefined();
  });

  it('hasBlueprintShape returns true only when blueprint key is present', () => {
    expect(service.hasBlueprintShape(JSON.stringify({ blueprint: {} }))).toBe(true);
    expect(service.hasBlueprintShape(JSON.stringify({ suggestions: [] }))).toBe(false);
    expect(service.hasBlueprintShape('not-json')).toBe(false);
    expect(service.hasBlueprintShape(null)).toBe(false);
  });
});
