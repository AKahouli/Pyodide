import { ConflictException } from '../../exceptions';
import { AgentExecutionSnapshotService } from './agent-execution-snapshot.service';
import type { AgentRecord } from '../repositories/agent-record.mapper';

const AGENT_ID = 'a'.repeat(24);

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    _id: AGENT_ID,
    name: 'Advisory Specialist',
    slug: 'advisory-specialist',
    agentType: 'b'.repeat(24),
    agentTypeSlug: 'mono_agent',
    role: 'Advisory',
    description: 'Answer advisory questions',
    temperature: 0.4,
    llmModel: 'gpt-4.1',
    reasoningEffort: 'medium',
    instruction: 'Specialist instructions',
    ignorePrePrompt: false,
    knowledgeBases: ['d'.repeat(24)],
    tools: ['tool-1'],
    skills: ['skill-1'],
    disabledSkills: [],
    connectors: ['conn-1'],
    connectorActionSelections: [{ connector: 'conn-1', actionKeys: ['crm.get_contact', 'crm.list_contacts'] }],
    guardrails: {},
    deploymentSettings: {},
    enable_temporary_child_agents: false,
    max_temporary_child_agents: 0,
    isDefault: false,
    isActive: true,
    isDefaultForType: false,
    createdBy: 'e'.repeat(24),
    a2aPublished: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('AgentExecutionSnapshotService', () => {
  const service = new AgentExecutionSnapshotService();

  it('digest is stable across computations and sensitive to definition changes', () => {
    const agent = makeAgent();
    const digest = service.computeDigest(agent);
    expect(service.computeDigest(makeAgent())).toBe(digest);

    const retyped = makeAgent({ instruction: 'Changed instructions' });
    expect(service.computeDigest(retyped)).not.toBe(digest);

    // List order must not matter (sorted before hashing).
    const reordered = makeAgent({
      tools: ['tool-1'],
      connectorActionSelections: [{ connector: 'conn-1', actionKeys: ['crm.list_contacts', 'crm.get_contact'] }],
    });
    expect(service.computeDigest(reordered)).toBe(digest);

    // Policy change (per-agent override added) changes the revision.
    const withPolicy = makeAgent({
      rootExecutionPolicy: { version: 1, delegation: { enabled: true } },
    });
    expect(service.computeDigest(withPolicy)).not.toBe(digest);
  });

  it('buildSnapshot returns a non-secret frozen definition and rejects a stale expected digest', () => {
    const agent = makeAgent();
    const digest = service.computeDigest(agent);
    const snapshot = service.buildSnapshot(agent, digest);
    expect(snapshot.agentId).toBe(AGENT_ID);
    expect(snapshot.definition.instruction).toBe('Specialist instructions');
    expect(snapshot.definition.connectorActionScopes).toEqual([
      { connectorId: 'conn-1', decision: 'SELECTED', actionKeys: ['crm.get_contact', 'crm.list_contacts'] },
    ]);

    expect(() => service.buildSnapshot(makeAgent({ instruction: 'Drifted' }), digest)).toThrow(
      ConflictException,
    );
  });

  it('compact catalog exposes metadata + digest only, defaulting to root_constrained', () => {
    const other = makeAgent({ _id: 'f'.repeat(24), name: 'Other', description: 'Other specialist' });
    const catalog = service.buildCompactCatalog(
      [makeAgent(), other],
      new Map([[other._id, 'native']]),
    );
    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toMatchObject({
      agentId: AGENT_ID,
      name: 'Advisory Specialist',
      mode: 'root_constrained',
    });
    expect(catalog[1].mode).toBe('native');
    for (const entry of catalog) {
      // Metadata only: no tool schemas, credentials or instructions leak.
      expect(Object.keys(entry).sort()).toEqual(['agentId', 'description', 'digest', 'mode', 'name']);
      expect(JSON.stringify(entry)).not.toContain('Specialist instructions');
    }
  });
});
