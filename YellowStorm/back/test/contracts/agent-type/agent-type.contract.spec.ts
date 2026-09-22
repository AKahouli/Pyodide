import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys } from '../wire-helpers';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import type { AgentTypeRow, AgentTypePromptRow } from '@modules/agent-type/persistence/agent-type.store';

const row: AgentTypeRow = {
  id: '64b000000000000000000801',
  name: 'Researcher',
  slug: 'researcher',
  defaultPrompt: 'You research.',
  skills: ['64b000000000000000000701'],
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const prompt: AgentTypePromptRow = {
  id: '64b000000000000000000802',
  agentTypeId: row.id,
  modelId: 'gpt-4o',
  prompt: 'Model specific prompt',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('agent-type response contract', () => {
  it('toResponse matches the fixture', () => {
    const body = toWire(callPrivate(AgentTypeService, 'toResponse', [row, 2]));
    expectContract('agent-type/agent-type', body);
    expect(body.id).toBe(row.id);
    expect(body.promptCount).toBe(2);
    expectNoMongoKeys(body);
  });

  it('toPromptResponse matches the prompt fixture', () => {
    const body = toWire(callPrivate(AgentTypeService, 'toPromptResponse', [prompt]));
    expectContract('agent-type/agent-type-prompt', body);
    expect(body.agentTypeId).toBe(row.id);
    expectNoMongoKeys(body);
  });
});
