import { getTableName, getTableColumns } from 'drizzle-orm';
import {
  agents,
  agentTools,
  agentSkills,
  agentDisabledSkills,
  agentConnectors,
  agentKnowledgeBases,
  agentConnectorActions,
} from './agents.schema';

describe('agents drizzle schema', () => {
  it('maps the agents table to snake_case db columns', () => {
    expect(getTableName(agents)).toBe('agents');
    const cols = getTableColumns(agents) as Record<string, { name: string }>;
    for (const name of [
      'id', 'name', 'slug', 'role', 'description', 'temperature', 'llmModel',
      'email', 'instruction', 'ignorePrePrompt', 'agentTypeId', 'agentTypeSlug',
      'guardrails', 'deploymentSettings', 'createdBy', 'createdAt', 'updatedAt',
    ]) {
      expect(cols[name]).toBeDefined();
    }
    expect(cols.agentTypeId.name).toBe('agent_type_id');
    expect(cols.agentTypeSlug.name).toBe('agent_type_slug');
    expect(cols.llmModel.name).toBe('llm_model');
  });

  it('defines the six junction tables', () => {
    expect(getTableName(agentTools)).toBe('agent_tools');
    expect(getTableName(agentSkills)).toBe('agent_skills');
    expect(getTableName(agentDisabledSkills)).toBe('agent_disabled_skills');
    expect(getTableName(agentConnectors)).toBe('agent_connectors');
    expect(getTableName(agentKnowledgeBases)).toBe('agent_knowledge_bases');
    expect(getTableName(agentConnectorActions)).toBe('agent_connector_actions');
    expect(getTableColumns(agentConnectorActions).actionKeys.name).toBe('action_keys');
  });
});
