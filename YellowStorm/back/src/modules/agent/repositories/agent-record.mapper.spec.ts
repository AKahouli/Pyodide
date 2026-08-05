import { rowToRecord, AgentJunctions } from './agent-record.mapper';
import type { agents } from '../../postgres/schema';

type Row = typeof agents.$inferSelect;

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'a'.repeat(24),
    name: 'Sales Bot',
    slug: 'sales-bot',
    role: 'Sell things',
    description: 'desc',
    temperature: 0.5,
    llmModel: 'gpt-x',
    email: 'a@b.co',
    instruction: 'do it',
    ignorePrePrompt: false,
    agentTypeId: 'b'.repeat(24),
    agentTypeSlug: 'mono-agent',
    enableTemporaryChildAgents: true,
    maxTemporaryChildAgents: 3,
    isDefault: false,
    isActive: true,
    isDefaultForType: false,
    createdBy: 'c'.repeat(24),
    guardrails: { promptInjection: { inputGuardrailEnabled: true } },
    deploymentSettings: { embedEnabled: true, restEnabled: false, widget: null },
    a2aPublished: false,
    a2aAgentId: null,
    a2aAgentCardUrl: null,
    a2aApiKeyHeader: null,
    a2aPublishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as Row;
}

const emptyJunctions: AgentJunctions = {
  tools: [], skills: [], disabledSkills: [], connectors: [], knowledgeBases: [], connectorActions: [],
};

describe('rowToRecord', () => {
  it('maps db row + junctions to a Mongo-lean-doc-shaped record', () => {
    const rec = rowToRecord(baseRow(), {
      ...emptyJunctions,
      tools: ['t'.repeat(24)],
      skills: ['s'.repeat(24)],
      disabledSkills: ['d'.repeat(24)],
      connectors: ['x'.repeat(24)],
      knowledgeBases: ['w'.repeat(24)],
      connectorActions: [{ connectorId: 'x'.repeat(24), actionKeys: ['send'] }],
    });

    expect(rec._id).toBe('a'.repeat(24));
    expect(rec.agentType).toBe('b'.repeat(24)); // id string, NOT populated
    expect(rec.agentTypeSlug).toBe('mono-agent');
    expect(rec.llmModel).toBe('gpt-x');
    expect(rec.tools).toEqual(['t'.repeat(24)]);
    expect(rec.skills).toEqual(['s'.repeat(24)]);
    expect(rec.disabledSkills).toEqual(['d'.repeat(24)]);
    expect(rec.connectors).toEqual(['x'.repeat(24)]);
    expect(rec.knowledgeBases).toEqual(['w'.repeat(24)]);
    expect(rec.connectorActionSelections).toEqual([{ connector: 'x'.repeat(24), actionKeys: ['send'] }]);
    // Mongo-style field names preserved for the existing mappers:
    expect(rec.enable_temporary_child_agents).toBe(true);
    expect(rec.max_temporary_child_agents).toBe(3);
    expect(rec.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('trims char(24) right-padding on ids', () => {
    const rec = rowToRecord(baseRow({ id: ('a'.repeat(24) + '      ') as any }), emptyJunctions);
    expect(rec._id).toBe('a'.repeat(24));
  });

  it('defaults optional/nullable fields safely', () => {
    const rec = rowToRecord(baseRow({ llmModel: null, email: null, guardrails: {}, deploymentSettings: {} }), emptyJunctions);
    expect(rec.llmModel).toBeUndefined();
    expect(rec.email).toBeUndefined();
    expect(rec.tools).toEqual([]);
    expect(rec.a2aPublished).toBe(false);
  });
});
