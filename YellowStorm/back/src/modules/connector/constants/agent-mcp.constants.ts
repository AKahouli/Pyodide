import { ConnectorActionSafety } from '../connector.types';

export const AGENT_MCP_CONNECTOR_SLUG = 'agent-mcp';

export const AGENT_MCP_RUNTIME_AUTH_SECRET_KEY = 'agent_mcp_ingress';

interface ActionSeed {
  key: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  safety: ConnectorActionSafety;
}

const str = (description: string) => ({ type: 'string', description });

/**
 * Snapshot of the mcp-agent server tool inventory (mcp-agent/server.py).
 * The connector runtime injects the selected workspace id into tool calls, so
 * every tool accepts (and ignores) a workspace_id argument.
 */
const WORKSPACE_ID_PROPERTY = { type: 'string', description: 'Accepted for platform compatibility; ignored.' };

const BASE_ACTIONS: ActionSeed[] = [
  {
    key: 'list_agent_types',
    label: 'List agent types',
    description: 'List active agent types usable when creating agents.',
    parameterSchema: { type: 'object', properties: {} },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'list_models',
    label: 'List models',
    description: 'List available LLM models assignable to agents.',
    parameterSchema: { type: 'object', properties: {} },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'list_agents',
    label: 'List agents',
    description: 'List all agents visible to the acting user (personal and default).',
    parameterSchema: { type: 'object', properties: {} },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'get_agent',
    label: 'Get agent',
    description: 'Get one agent by id with its full configuration.',
    parameterSchema: {
      type: 'object',
      properties: { agent_id: str('Agent id') },
      required: ['agent_id'],
    },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'create_agent',
    label: 'Create agent',
    description: 'Create a new personal agent owned by the acting user and return it with its id.',
    parameterSchema: {
      type: 'object',
      properties: {
        name: str('Agent name (letters, numbers and spaces)'),
        agent_type_id: str('Agent type id or slug from list_agent_types'),
        role: str('Agent role/behavior description'),
        description: str('Short agent description'),
        instruction: str('Additional instructions'),
        model: str('Model id from list_models'),
        temperature: { type: 'number', description: 'Temperature between 0 and 1' },
      },
      required: ['name', 'agent_type_id', 'role'],
    },
    safety: ConnectorActionSafety.WRITE,
  },
  {
    key: 'update_agent',
    label: 'Update agent',
    description: 'Update an existing personal agent; only provided fields change.',
    parameterSchema: {
      type: 'object',
      properties: {
        agent_id: str('Agent id'),
        name: str('Agent name'),
        role: str('Agent role'),
        description: str('Agent description'),
        instruction: str('Additional instructions'),
        model: str('Model id'),
        temperature: { type: 'number', description: 'Temperature between 0 and 1' },
        is_active: { type: 'boolean', description: 'Whether the agent is active' },
      },
      required: ['agent_id'],
    },
    safety: ConnectorActionSafety.WRITE,
  },
  {
    key: 'delete_agent',
    label: 'Delete agent',
    description: 'Delete one personal agent and remove it from all teams it belongs to.',
    parameterSchema: {
      type: 'object',
      properties: { agent_id: str('Agent id') },
      required: ['agent_id'],
    },
    safety: ConnectorActionSafety.DELETE,
  },
  {
    key: 'list_teams',
    label: 'List teams',
    description: 'List all active teams visible to the acting user (owned and shared).',
    parameterSchema: { type: 'object', properties: {} },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'get_team',
    label: 'Get team',
    description: 'Get one team with its member agents and hierarchy.',
    parameterSchema: {
      type: 'object',
      properties: { team_id: str('Team id') },
      required: ['team_id'],
    },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'create_team',
    label: 'Create team',
    description: 'Create a new team owned by the acting user and return it with its id.',
    parameterSchema: {
      type: 'object',
      properties: {
        name: str('Team name (2-100 characters)'),
        description: str('Team description'),
        agent_ids: { type: 'array', items: { type: 'string' }, description: 'Agent ids to include' },
      },
      required: ['name'],
    },
    safety: ConnectorActionSafety.WRITE,
  },
  {
    key: 'update_team',
    label: 'Update team',
    description: 'Update team metadata or reconcile its flat agent list; only provided fields change.',
    parameterSchema: {
      type: 'object',
      properties: {
        team_id: str('Team id'),
        name: str('Team name'),
        description: str('Team description'),
        agent_ids: { type: 'array', items: { type: 'string' }, description: 'Agent ids' },
        is_active: { type: 'boolean', description: 'Whether the team is active' },
      },
      required: ['team_id'],
    },
    safety: ConnectorActionSafety.WRITE,
  },
  {
    key: 'update_team_hierarchy',
    label: 'Update team hierarchy',
    description: 'Replace the team hierarchy (org chart). Each member is {agent_id, parent_agent_id, order, position_x, position_y}; parent_agent_id null means root.',
    parameterSchema: {
      type: 'object',
      properties: {
        team_id: str('Team id'),
        members: {
          type: 'array',
          description: 'Full members list (replaces existing)',
          items: {
            type: 'object',
            properties: {
              agent_id: str('Agent id'),
              parent_agent_id: str('Parent agent id, null for root'),
              order: { type: 'number', description: 'Sort order among siblings' },
              position_x: { type: 'number', description: 'X coordinate for org chart rendering' },
              position_y: { type: 'number', description: 'Y coordinate for org chart rendering' },
            },
            required: ['agent_id'],
          },
        },
      },
      required: ['team_id', 'members'],
    },
    safety: ConnectorActionSafety.WRITE,
  },
  {
    key: 'delete_team',
    label: 'Delete team',
    description: 'Delete one owned team and its shares.',
    parameterSchema: {
      type: 'object',
      properties: { team_id: str('Team id') },
      required: ['team_id'],
    },
    safety: ConnectorActionSafety.DELETE,
  },
];

export const AGENT_MCP_ACTIONS: ActionSeed[] = BASE_ACTIONS.map((action) => ({
  ...action,
  parameterSchema: {
    ...action.parameterSchema,
    properties: {
      ...(action.parameterSchema.properties as Record<string, unknown>),
      workspace_id: WORKSPACE_ID_PROPERTY,
    },
  },
}));
