import { PlaybookFlowPrimitiveRegistryService } from './playbook-flow-primitive-registry.service';

describe('PlaybookFlowPrimitiveRegistryService', () => {
  const service = new PlaybookFlowPrimitiveRegistryService();

  it('returns prompt specs without runtime hooks', () => {
    const catalog = service.getPromptCatalog();

    expect(catalog.map((primitive) => primitive.kind)).toEqual([
      'agent',
      'action',
      'evaluation',
      'iterator',
      'router',
      'human_approval',
    ]);
    expect(JSON.stringify(catalog)).not.toContain('normalizeOutputPorts');
  });

  it('protects the shared prompt catalog from caller mutation', () => {
    const catalog = service.getPromptCatalog();
    catalog[0].selectionRules.push('mutated');
    ((catalog.find((primitive) => primitive.kind === 'router')?.configSchemaHint.router as any).outputLabels as string[]).push('mutated');

    expect(service.getPromptCatalog()[0].selectionRules).not.toContain('mutated');
    expect((service.getPromptCatalog().find((primitive) => primitive.kind === 'router')?.configSchemaHint.router as any).outputLabels).not.toContain('mutated');
  });

  it('normalizes router output ports from declared labels', () => {
    const runtime = service.getRuntimeSpec('router');

    expect(runtime?.normalizeOutputPorts?.([{ id: 'yes', artifactKind: 'data' }], {
      kind: 'router',
      router: { outputLabels: ['yes', 'no', 'no'] },
    })).toEqual([
      { id: 'yes', artifactKind: 'data' },
      { id: 'no', name: 'no', artifactKind: 'text' },
    ]);
  });

  it('compiles human approval primitive config into a task patch', () => {
    const runtime = service.getRuntimeSpec('human_approval');

    expect(runtime?.compileTaskPatch?.({
      kind: 'human_approval',
      humanApproval: { promptTemplate: 'Approve?', approvalMode: 'approve_reject' },
    })).toEqual({ humanApprovalConfig: { promptTemplate: 'Approve?', approvalMode: 'approve_reject' } });
  });

  it('reports unknown primitive kinds without throwing', () => {
    expect(service.getRuntimeSpec('custom')).toBeNull();
    expect(service.isKnownPrimitive('custom')).toBe(false);
  });
});
