import { createHash } from 'node:crypto';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';
import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';

/** Frozen admission authority without credentials, document contents or prompts. */
export interface RootCapabilityCeiling {
  toolDigests: string[];
  workspaceIds: string[];
  skillDigests: string[];
  connectors: Array<{
    connectorId: string;
    configurationDigest: string;
    actionDigests: string[];
    requiredParameterDigests: Record<string, string>;
  }>;
}

const digest = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

export function toolDefinition(tool: Record<string, unknown>): Record<string, unknown> {
  // buildToolsWithTokens injects this acting-user credential at hydration.
  const { accessToken, ...definition } = tool;
  return definition;
}

function bindingConfiguration(binding: Record<string, unknown>): Record<string, unknown> {
  const { actions, fixed_params, enforced_params, auth_headers, auth_env, ...configuration } = binding;
  return configuration;
}

export function freezeRootCapabilityCeiling(root: IGrpcAgent): RootCapabilityCeiling {
  return {
    toolDigests: root.tools.map((tool) => digest(toolDefinition(tool))),
    workspaceIds: root.brain_context.map((context) => context.workspace_id),
    skillDigests: (root.skills ?? []).map(digest),
    connectors: (root.connector_bindings ?? []).map((binding) => ({
      connectorId: String(binding.connector_id ?? ''),
      configurationDigest: digest(bindingConfiguration(binding)),
      actionDigests: (Array.isArray(binding.actions) ? binding.actions : []).map(digest),
      requiredParameterDigests: Object.fromEntries(
        Object.entries(binding.fixed_params ?? {}).map(([key, value]) => [key, digest(value)]),
      ),
    })),
  };
}

export function scopeCandidateToFrozenCeiling(candidate: IGrpcAgent, ceiling: RootCapabilityCeiling): IGrpcAgent {
  const connectorBindings: Record<string, unknown>[] = (candidate.connector_bindings ?? []).flatMap((binding) => {
    const approved = ceiling.connectors.find((entry) => entry.connectorId
      && entry.connectorId === binding.connector_id
      && entry.configurationDigest === digest(bindingConfiguration(binding)));
    if (!approved) return [];
    const params = (binding.fixed_params ?? {}) as Record<string, unknown>;
    if (Object.entries(approved.requiredParameterDigests).some(([key, expected]) =>
      !Object.hasOwn(params, key) || digest(params[key]) !== expected)) return [];
    const actions = (Array.isArray(binding.actions) ? binding.actions : [])
      .filter((action) => approved.actionDigests.includes(digest(action)));
    if (!actions.length) return [];
    return [{ ...binding, actions, enforced_params: Object.fromEntries(
      Object.keys(approved.requiredParameterDigests).map((key) => [key, params[key]]),
    ) }];
  });
  return {
    ...candidate,
    tools: candidate.tools.filter((tool) => ceiling.toolDigests.includes(digest(toolDefinition(tool)))),
    brain_context: candidate.brain_context.filter((context) => ceiling.workspaceIds.includes(context.workspace_id)),
    skills: (candidate.skills ?? []).filter((skill) => ceiling.skillDigests.includes(digest(skill))),
    connector_bindings: connectorBindings,
    connectorIds: connectorBindings.map((binding) => String(binding.connector_id)),
    agent_params: { ...candidate.agent_params, params: { ...candidate.agent_params?.params,
      connector_bindings_json: JSON.stringify(connectorBindings) } },
  };
}
