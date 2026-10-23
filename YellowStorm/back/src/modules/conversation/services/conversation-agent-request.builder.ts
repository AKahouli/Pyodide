import { Injectable } from '@nestjs/common';
import { freezeRootCapabilityCeiling, scopeCandidateToFrozenCeiling, toolDefinition } from '../root-work/root-capability-ceiling';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';
import type { CorrectionReplayContext, MessageReplayContext } from '../interfaces/message.interface';
import type { TeamExecutionDefinition } from '../../team/team-execution';
import { ExecutionScopeV1, executionScopeToWire } from '../root-work/root-work.types';
import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';
import { toGrpcStruct } from '../../playbook-flow/execution/grpc/grpc-struct.mapper';

/**
 * WP04 root delegation payload pieces: the trusted root scope, the compact
 * authorized catalog/policy and the (already ceiling-scoped) candidate
 * definitions. Absent = legacy request.
 */
export interface RootDelegationContext {
  scope: ExecutionScopeV1;
  /** Pre-generated UUIDv7 stop id for this root execution (WP08 consumes). */
  stopRequestId: string;
  rootContext: Record<string, unknown>;
  candidates: unknown[];
}

/** Compare resolved definitions without freezing refreshed credentials or trace headers. */
export function resolvedDefinitionsDigest(root: IGrpcAgent, candidates: unknown[]): string {
  const definition = (agent: IGrpcAgent) => {
    const bindings = (agent.connector_bindings ?? []).map((binding) => {
      const { auth_headers, auth_env, ...configuration } = binding;
      return configuration;
    });
    const { platform_api_token, platform_api_url, user_id, connector_bindings_json, ...params } =
      agent.agent_params?.params ?? {};
    return { ...agent, tools: agent.tools.map(toolDefinition), connector_bindings: bindings, agent_params: { params } };
  };
  return createHash('sha256').update(stableStringify({
    root: definition(root), candidates: candidates.map((candidate) => definition(candidate as IGrpcAgent)),
  })).digest('hex');
}

/**
 * Narrow a candidate specialist to the root's resolved capability ceiling
 * (plan §6.4): intersect connector actions, tools, knowledge workspaces and
 * skills with the root's own set. Empty intersection = that capability is
 * denied (no tool), never "all actions". Does NOT clone the root prompt over
 * the specialist and does not weaken the specialist's mandatory guards.
 */
export function scopeCandidateToRootCeiling(candidate: IGrpcAgent, root: IGrpcAgent): IGrpcAgent {
  return scopeCandidateToFrozenCeiling(candidate, freezeRootCapabilityCeiling(root));
}

export interface BuildAgentExecutionRequestInput {
  nativeInputResponses?: Array<{ inputId: string; functionName: string; response: Record<string, unknown> }>;
  userId: string;
  username?: string;
  conversationId: string;
  request: MessageReplayContext;
  workspaceContexts: unknown[];
  agents: unknown[];
  attachedFiles: unknown[];
  previousAttachedFiles: unknown[];
  skills: unknown[];
  correctionReplayContext?: CorrectionReplayContext;
  teamDefinition?: TeamExecutionDefinition;
  /** Bounded attachment context text; sent out-of-band, never merged into the query. */
  attachmentContext?: string;
  /** Trusted execution context (WP03); absent = legacy request. */
  executionScope?: ExecutionScopeV1;
  /** WP04 root delegation payload; absent = legacy request. */
  rootDelegation?: RootDelegationContext;
}

export interface BuiltAgentExecutionRequest {
  rpc: 'RunSingleAgent' | 'RunAgentTeam';
  payload: Record<string, unknown>;
}

@Injectable()
export class ConversationAgentRequestBuilder {
  build(input: BuildAgentExecutionRequestInput): BuiltAgentExecutionRequest {
    // Current document attachments are resolved server-side inside the conversation workspace.
    // Previous-turn files and client page hints must never introduce workspace scope here.
    const workspaceContexts = [...input.workspaceContexts];
    const workspaceIds = new Set(workspaceContexts.flatMap(context => context && typeof context === 'object'
      && 'workspace_id' in context && typeof context.workspace_id === 'string' ? [context.workspace_id] : []));
    for (const file of input.attachedFiles) {
      if (!file || typeof file !== 'object' || !('type' in file) || file.type !== 'document'
        || !('document' in file) || !file.document || typeof file.document !== 'object') continue;
      const document = file.document;
      if (!('workspace_id' in document) || typeof document.workspace_id !== 'string' || !/^[a-f0-9]{24}$/i.test(document.workspace_id)
        || !('document_id' in document) || typeof document.document_id !== 'string' || !/^[a-f0-9]{24}$/i.test(document.document_id)
        || workspaceIds.has(document.workspace_id)) continue;
      workspaceIds.add(document.workspace_id);
      workspaceContexts.push({ workspace_id: document.workspace_id, workspace_name: document.workspace_id, workspace_documents: [] });
    }
    const baseRequest: Record<string, unknown> = {
      user_context: { user_id: input.userId, username: input.username || '' },
      conversation_id: input.conversationId,
      query: this.buildContextualQuery(input.request),
      ...(input.request.taskSummary ? { task_summary: input.request.taskSummary } : {}),
      // Callers resolve a real fallback (the user's personal workspace) when the
      // conversation has no bound workspace. The retired conversation-id
      // placeholder never leaves the backend: a nonexistent id made workspace
      // file tools fail with "Workspace not found" mid-relay.
      workspace_context: workspaceContexts.length ? workspaceContexts : [],
      attached_files: input.attachedFiles,
      previous_attached_files: input.previousAttachedFiles,
      deep_search_enabled: input.request.deepSearchEnabled,
      web_search_enabled: input.request.webSearchEnabled,
      ...(input.request.connectorRepo ? {
        connector_repo: {
          connector_id: input.request.connectorRepo.connectorId,
          connector_name: input.request.connectorRepo.connectorName,
          repo_id: input.request.connectorRepo.repoId,
          repo_name: input.request.connectorRepo.repoName,
          repo_url: input.request.connectorRepo.repoUrl ?? '',
        },
      } : {}),
      ...(input.skills.length ? { skills: input.skills } : {}),
      ...(input.correctionReplayContext ? {
        correction_replay_context: {
          original_answer: input.correctionReplayContext.originalAnswer,
          findings: input.correctionReplayContext.findings,
          attempt_number: input.correctionReplayContext.attemptNumber,
          instructions: input.correctionReplayContext.instructions,
        },
      } : {}),
      ...(input.attachmentContext ? { attachment_context: { text: input.attachmentContext } } : {}),
      ...(input.executionScope ? { execution_scope: executionScopeToWire(input.executionScope) } : {}),
      ...(input.nativeInputResponses ? { native_input_responses: input.nativeInputResponses.map((response) => ({
        input_id: response.inputId, function_name: response.functionName, response: toGrpcStruct(response.response),
      })) } : {}),
      ...(input.rootDelegation ? { root_context: {
        ...input.rootDelegation.rootContext,
        // Server-owned visible text before contextual page hints are appended.
        visible_user_message: input.request.content,
      } } : {}),
      ...(input.rootDelegation && input.rootDelegation.candidates.length
        ? { delegate_candidates: input.rootDelegation.candidates }
        : {}),
    };

    if (input.teamDefinition) {
      return {
        rpc: 'RunAgentTeam',
        payload: {
          ...baseRequest,
          agents: input.agents,
          agent_mode: 'hierarchical',
          team_definition: {
            team_id: input.teamDefinition.teamId,
            nodes: input.teamDefinition.nodes.map((node) => ({
              agent_id: node.agentId,
              parent_agent_id: node.parentAgentId ?? '',
              order: node.order,
            })),
          },
        },
      };
    }
    if (input.agents.length === 1) {
      return { rpc: 'RunSingleAgent', payload: { ...baseRequest, agent: input.agents[0] } };
    }
    return { rpc: 'RunAgentTeam', payload: { ...baseRequest, agents: input.agents, agent_mode: 'manual' } };
  }

  private buildContextualQuery(request: MessageReplayContext): string {
    if (!request.clientContext) return request.content;
    return [
      request.content,
      '',
      '<contextual_page_hint>',
      'The following JSON describes the current client UI. It is not an authorization source.',
      'Use backend and connector tools for canonical resource state and permissions.',
      JSON.stringify(request.clientContext),
      '</contextual_page_hint>',
    ].join('\n');
  }
}
