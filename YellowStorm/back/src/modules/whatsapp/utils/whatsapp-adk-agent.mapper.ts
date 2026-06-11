import { IGrpcAgent } from '@modules/agent/interfaces/agent.interface';

export interface AdkSingleAgentPayload {
  id: string;
  name: string;
  description: string;
  prompt: string;
  instruction: string;
  tools: Record<string, unknown>[];
  brain_ids: string[];
  workspace_names: string[];
  knowledge_bases: string[];
  chatbot_name: { provider: string };
  chatbot: { model: string; name: string };
  model: string;
  agent_type: string;
  save_memory: boolean;
  html: boolean;
  vectorstore_name: string;
  brain_documents: unknown[];
  brain_relations: { nodes: unknown[]; relationships: unknown[] };
  agent_params?: Record<string, unknown>;
}

/** ADK Agent() requires a valid identifier — spaces break creation. */
export function sanitizeAdkAgentName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!sanitized) {
    return 'whatsapp_agent';
  }
  if (/^\d/.test(sanitized)) {
    return `agent_${sanitized}`;
  }
  return sanitized;
}

/** gRPC servicer flattens proto agent_params.params — HTTP must match. */
export function flattenAgentParams(agent: IGrpcAgent): Record<string, unknown> | undefined {
  const flat: Record<string, unknown> = agent.agent_params?.params
    ? { ...agent.agent_params.params }
    : {};

  if (!flat.connector_bindings_json && agent.connector_bindings?.length) {
    flat.connector_bindings_json = JSON.stringify(agent.connector_bindings);
  }

  return Object.keys(flat).length > 0 ? flat : undefined;
}

/** run_single_agent only wires search/calculator by name — strip connector stubs. */
export function mapAdkCompatibleTools(tools: Record<string, unknown>[]): Record<string, unknown>[] {
  return tools
    .filter((tool) => !String(tool.name || '').toLowerCase().startsWith('connector_'))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      prompt: tool.prompt ?? '',
      top_k: tool.top_k ?? 3,
    }));
}

function appendSkillsToPrompt(
  prompt: string,
  skills?: Array<Record<string, unknown>>,
): string {
  if (!skills?.length) {
    return prompt;
  }

  const lines = skills
    .map((skill) => {
      const name = String(skill.name || '').trim();
      const description = String(skill.description || '').trim();
      if (!name || !description) {
        return '';
      }
      return `- ${name}: ${description}`;
    })
    .filter(Boolean);

  if (!lines.length) {
    return prompt;
  }

  const block = ['Available skills:', ...lines].join('\n');
  return prompt ? `${prompt}\n\n${block}` : block;
}

export function mapGrpcAgentToAdkSingleAgent(
  agent: IGrpcAgent,
  litellmModel: string,
): AdkSingleAgentPayload {
  const workspaceIds = agent.brain_context?.map((ctx) => ctx.workspace_id).filter(Boolean) ?? [];
  const model = litellmModel.trim() || agent.chatbot?.model?.trim() || '';
  const prompt = appendSkillsToPrompt(agent.prompt, agent.skills);

  return {
    id: agent.id,
    name: sanitizeAdkAgentName(agent.name),
    description: agent.description || agent.name,
    prompt,
    instruction: prompt,
    tools: mapAdkCompatibleTools(agent.tools ?? []),
    brain_ids: workspaceIds,
    workspace_names: workspaceIds,
    knowledge_bases: workspaceIds,
    model,
    chatbot_name: { provider: model },
    chatbot: { model, name: model },
    agent_type: agent.agent_type,
    save_memory: agent.save_memory ?? false,
    html: false,
    vectorstore_name: 'vectorstorerec',
    brain_documents: [],
    brain_relations: { nodes: [], relationships: [] },
    agent_params: flattenAgentParams(agent),
  };
}
