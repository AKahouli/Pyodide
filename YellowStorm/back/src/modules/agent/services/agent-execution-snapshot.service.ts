import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConflictException, ErrorCode } from '../../exceptions';
import type { AgentRecord } from '../repositories/agent-record.mapper';

/**
 * Immutable non-secret execution snapshots and compact catalogs (WP03, plan
 * §6.3). The compact catalog is safe to embed in a root prompt: candidate
 * metadata only, never tool schemas, credentials, document contents or skill
 * instructions. The full snapshot is built lazily, only for the candidate the
 * root actually chose; a stale expectedDigest rejects instead of silently
 * reading a mutated definition.
 *
 * The digest covers the durable definition inputs (instruction, pre-prompt
 * policy, model params, tool/skill/knowledge bindings, connector action
 * selections, root policy revision). Request-time prompt assembly (agent-type
 * prompt resolution) is resolved again at compile time; WP04 may extend the
 * digest inputs if type-prompt drift becomes observable here.
 */

/** Typed connector action scope (plan §6.4): empty intersection = deny. */
export interface ConnectorActionScope {
  connectorId: string;
  decision: 'ALL_APPROVED' | 'SELECTED';
  /** Present when decision is SELECTED; empty array denies every action. */
  actionKeys?: string[];
}

/** Frozen, non-secret definition an ADK worker compiles from. */
export interface AgentExecutionSnapshotV1 {
  digest: string;
  agentId: string;
  definition: {
    name: string;
    instruction: string;
    ignorePrePrompt: boolean;
    role: string;
    llmModel: string | undefined;
    temperature: number;
    reasoningEffort: string | undefined;
    tools: string[];
    skills: string[];
    disabledSkills: string[];
    knowledgeBaseIds: string[];
    connectorActionScopes: ConnectorActionScope[];
    rootPolicyRevision: string | null;
    definitionUpdatedAt: Date;
    /** Digest input mirror of definitionUpdatedAt (Date serializes as {}). */
    updatedAtMs: number;
  };
  createdAt: Date;
}

/** Compact catalog entry: metadata only, safe for a root prompt. */
export interface CompactCatalogCandidate {
  agentId: string;
  name: string;
  description: string;
  mode: 'native' | 'root_constrained';
  digest: string;
}

/** Deterministic JSON so the digest is stable across processes. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function policyRevision(policy: AgentRecord['rootExecutionPolicy']): string | null {
  if (!policy) {
    return null;
  }
  return createHash('sha256').update(stableStringify(policy)).digest('hex');
}

function connectorActionScopes(agent: AgentRecord): ConnectorActionScope[] {
  return (agent.connectorActionSelections ?? [])
    .map((selection) => ({
      connectorId: selection.connector,
      // Selections are always explicit key lists; the ADK side intersects them
      // with the approved set where empty means deny, never "all actions"
      // (plan §6.4).
      decision: 'SELECTED' as const,
      actionKeys: [...selection.actionKeys].sort(),
    }))
    .sort((a, b) => (a.connectorId < b.connectorId ? -1 : a.connectorId > b.connectorId ? 1 : 0));
}

@Injectable()
export class AgentExecutionSnapshotService {
  /** Stable digest of everything the compiled worker depends on. */
  computeDigest(agent: AgentRecord): string {
    return createHash('sha256').update(stableStringify(this.definitionOf(agent))).digest('hex');
  }

  /**
   * Build the snapshot lazily for one selected candidate. When expectedDigest
   * is supplied and no longer matches, the configuration changed under us:
   * reject instead of compiling a mutated definition (plan §6.3).
   */
  buildSnapshot(agent: AgentRecord, expectedDigest?: string): AgentExecutionSnapshotV1 {
    const digest = this.computeDigest(agent);
    if (expectedDigest && expectedDigest !== digest) {
      throw new ConflictException(
        ErrorCode.VALIDATION_ERROR,
        `Agent configuration changed since delegation was planned (expected ${expectedDigest.slice(0, 12)}…, current ${digest.slice(0, 12)}…)`,
      );
    }
    return {
      digest,
      agentId: agent._id,
      definition: this.definitionOf(agent),
      createdAt: new Date(),
    };
  }

  /** Compact authorized catalog — metadata only, one entry per candidate. */
  buildCompactCatalog(
    agents: AgentRecord[],
    modes: Map<string, 'native' | 'root_constrained'>,
  ): CompactCatalogCandidate[] {
    return agents.map((agent) => ({
      agentId: agent._id,
      name: agent.name,
      description: agent.description,
      mode: modes.get(agent._id) ?? 'root_constrained',
      digest: this.computeDigest(agent),
    }));
  }

  private definitionOf(agent: AgentRecord): AgentExecutionSnapshotV1['definition'] {
    return {
      name: agent.name,
      instruction: agent.instruction,
      ignorePrePrompt: agent.ignorePrePrompt,
      role: agent.role,
      llmModel: agent.llmModel,
      temperature: agent.temperature,
      reasoningEffort: agent.reasoningEffort,
      tools: [...(agent.tools ?? [])].sort(),
      skills: [...(agent.skills ?? [])].sort(),
      disabledSkills: [...(agent.disabledSkills ?? [])].sort(),
      knowledgeBaseIds: [...(agent.knowledgeBases ?? [])].sort(),
      connectorActionScopes: connectorActionScopes(agent),
      rootPolicyRevision: policyRevision(agent.rootExecutionPolicy),
      // Epoch ms: stableStringify(Date) would serialize as {} and stop
      // busting the digest on definition changes.
      definitionUpdatedAt: agent.updatedAt,
      updatedAtMs: agent.updatedAt.getTime(),
    };
  }
}
