import { Injectable } from '@nestjs/common';
import { ConflictException, ForbiddenException, NotFoundException, ValidationException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { UserGroupService } from '@modules/user-group';
import { CreateGovernanceScopeDto, GovernanceScopeKnowledgeDto, UpdateGovernanceScopeDto } from '../dto';
import {                   
  type GovernanceScopeKnowledge,                    
  type GovernanceScopeRecord,                    
} from '../persistence';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';
import type { GovernanceScopeType } from '../domain/governance-types';
import { PgGovernanceTransactionRunner } from '../persistence/postgres/pg-transaction-runner';
import { PgMetricStore } from '../persistence/postgres/pg-metric.store';
import { PgPublicationAttemptStore } from '../persistence/postgres/pg-publication-attempt.store';
import { PgDryRunStore } from '../persistence/postgres/pg-dry-run.store';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';
import { PgGovernanceDocumentStore } from '../persistence/postgres/pg-document.store';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';
import { PgMembershipStore } from '../persistence/postgres/pg-membership.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';

export interface GovernanceScopeKnowledgeResponse {
  sourceMode: 'llm_only' | 'workspaces_only';
  webSourcesEnabled: boolean;
  webAllowedDomains: string[];
  webBlockedDomains: string[];
}

export interface GovernanceScopeResponse {
  id: string;
  programId: string;
  parentScopeId?: string;
  name: string;
  type: string;
  status: 'active' | 'inactive';
  agentIds: string[];
  metadata: Record<string, unknown>;
  knowledge: GovernanceScopeKnowledgeResponse;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceScopeService {
  constructor(
    private readonly scopeStore: PgScopeStore,
    private readonly documentStore: PgGovernanceDocumentStore,
    private readonly bindingStore: PgBindingStore,
    private readonly membershipStore: PgMembershipStore,
    private readonly deploymentStore: PgDeploymentStore,
    private readonly revisionStore: PgRevisionStore,
    private readonly dryRunStore: PgDryRunStore,
    private readonly metricStore: PgMetricStore,
    private readonly publicationAttemptStore: PgPublicationAttemptStore,
    private readonly programService: GovernanceProgramService,
    private readonly userGroupService: UserGroupService,
    private readonly auditLogService: AuditLogService,
    private readonly draftPreparation: GovernanceDraftPreparationService,
    private readonly tx: PgGovernanceTransactionRunner,
  ) {}

  async create(ownerUserId: string, programId: string, dto: CreateGovernanceScopeDto): Promise<GovernanceScopeResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertNoDuplicate(programId, dto.name.trim());
    await this.assertValidParent(programId, dto.parentScopeId);
    const metadata = dto.metadata ? this.normalizeDescription(dto.metadata) : undefined;
    const knowledge = dto.knowledge ? this.normalizeKnowledge(dto.knowledge) : undefined;
    const scope = await this.scopeStore.insert({
      programId,
      name: dto.name.trim(),
      type: dto.type as GovernanceScopeType | undefined,
      status: dto.status,
      parentScopeId: dto.parentScopeId,
      agentIds: dto.agentIds,
      metadata,
      knowledge,
    });
    return this.toResponse(scope);
  }

  async list(ownerUserId: string, programId: string): Promise<GovernanceScopeResponse[]> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const accessibleScopeIds = await this.getAccessibleScopeIds(ownerUserId, programId);
    const scopes = await this.scopeStore.listByProgram(programId, accessibleScopeIds.includes('*') ? '*' : accessibleScopeIds);
    return scopes.map((scope) => this.toResponse(scope));
  }

  async findById(ownerUserId: string, programId: string, scopeId: string): Promise<GovernanceScopeResponse> {
    const scope = await this.findOwnedScope(ownerUserId, programId, scopeId);
    return this.toResponse(scope);
  }

  async update(ownerUserId: string, ownerEmail: string, programId: string, scopeId: string, dto: UpdateGovernanceScopeDto): Promise<GovernanceScopeResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertScopeAccess(ownerUserId, programId, scopeId);
    await this.assertCanUpdateScope(ownerUserId, programId, scopeId, dto);
    const current = await this.scopeStore.findByProgramAndId(programId, scopeId);
    if (!current) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    if (dto.name !== undefined) await this.assertNoDuplicate(programId, dto.name.trim(), scopeId);
    if (dto.parentScopeId !== undefined) await this.assertValidParent(programId, dto.parentScopeId, scopeId);
    if (dto.metadata !== undefined) this.assertMetadataUpdateAllowed(dto.metadata);
    if (dto.status === 'inactive') await this.suspendPublishedDeployment(ownerUserId, ownerEmail, programId, scopeId);
    const updated = await this.scopeStore.update(scopeId, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.parentScopeId !== undefined ? { parentScopeId: dto.parentScopeId || null } : {}),
      ...(dto.type !== undefined ? { type: dto.type as GovernanceScopeType } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.agentIds !== undefined ? { agentIds: dto.agentIds } : {}),
      ...(dto.knowledge !== undefined ? { knowledge: this.normalizeKnowledge(dto.knowledge) } : {}),
      ...(dto.metadata !== undefined ? { metadata: this.mergeMetadata(current.metadata, this.normalizeDescription(dto.metadata)) } : {}),
    });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    const materialChange = dto.name !== undefined || dto.parentScopeId !== undefined || dto.type !== undefined || dto.status !== undefined || dto.agentIds !== undefined || dto.metadata?.classification !== undefined;
    if (materialChange) await this.draftPreparation.prepare(ownerUserId, ownerEmail, programId, scopeId);
    return this.toResponse(updated);
  }

  async delete(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    await this.findOwnedScope(ownerUserId, programId, scopeId);
    await this.assertCanDeleteScope(ownerUserId, programId, scopeId);
    await this.deleteScopeTree(programId, scopeId);
  }

  /** Deletes the scope and its whole subtree atomically, children before parents, set-based. */
  private async deleteScopeTree(programId: string, scopeId: string): Promise<void> {
    await this.tx.run(async () => {
      const scopeIds = this.collectSubtree(scopeId, await this.scopeStore.listHierarchy(programId));
      const scopeIdSet = new Set(scopeIds);
      const deploymentIds = (await this.deploymentStore.listByProgram(programId)).filter((deployment) => scopeIdSet.has(deployment.scopeId)).map((deployment) => deployment.id);
      await this.bindingStore.removeScopesFromProgramBindings(programId, scopeIds);
      await this.documentStore.clearOwnerScopes(programId, scopeIds);
      await this.membershipStore.deleteByProgramAndScopeIds(programId, scopeIds);
      await this.metricStore.deleteByProgramAndScopeIds(programId, scopeIds);
      await this.dryRunStore.deleteByProgramAndScopeIds(programId, scopeIds);
      await this.publicationAttemptStore.deleteByProgramAndScopeIds(programId, scopeIds);
      await this.revisionStore.deleteByDeploymentIds(deploymentIds);
      await this.deploymentStore.deleteByProgramAndScopeIds(programId, scopeIds);
      await this.scopeStore.deleteByIdsAndProgram(scopeIds, programId);
    });
  }

  /** Breadth-first subtree walk (root first); the visited set guards against parent cycles. */
  private collectSubtree(rootId: string, hierarchy: { id: string; parentScopeId: string | null }[]): string[] {
    const childrenByParent = new Map<string, string[]>();
    for (const node of hierarchy) {
      if (!node.parentScopeId) continue;
      childrenByParent.set(node.parentScopeId, [...(childrenByParent.get(node.parentScopeId) ?? []), node.id]);
    }
    const visited = new Set<string>([rootId]);
    const queue = [rootId];
    for (let index = 0; index < queue.length; index += 1) {
      for (const child of childrenByParent.get(queue[index]) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        queue.push(child);
      }
    }
    return queue;
  }

  private async assertCanDeleteScope(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    if (await this.isProgramOwner(ownerUserId, programId)) return;
    const groupIds = await this.userGroupService.findGroupIdsForMember(ownerUserId);
    const memberships = await this.membershipStore.findActiveForUser(programId, ownerUserId, groupIds);
    const allowed = memberships.some((membership) => (!membership.scopeId && membership.role === 'program_admin') || (membership.scopeId === scopeId && membership.role === 'scope_admin'));
    if (allowed) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  private async assertCanUpdateScope(ownerUserId: string, programId: string, scopeId: string, dto: UpdateGovernanceScopeDto): Promise<void> {
    if (!this.hasScopeManagementFields(dto)) return;
    if (await this.canManageScope(ownerUserId, programId, scopeId)) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  private hasScopeManagementFields(dto: UpdateGovernanceScopeDto): boolean {
    if (dto.name !== undefined || dto.parentScopeId !== undefined || dto.type !== undefined || dto.status !== undefined || dto.agentIds !== undefined || dto.knowledge !== undefined) return true;
    if (!dto.metadata) return false;
    return Object.keys(dto.metadata).some((key) => key !== 'review');
  }

  private async canManageScope(ownerUserId: string, programId: string, scopeId: string): Promise<boolean> {
    if (await this.isProgramOwner(ownerUserId, programId)) return true;
    const groupIds = await this.userGroupService.findGroupIdsForMember(ownerUserId);
    const memberships = await this.membershipStore.findActiveForUser(programId, ownerUserId, groupIds);
    return memberships.some((membership) => ['program_admin', 'scope_admin'].includes(membership.role) && (!membership.scopeId || membership.scopeId === scopeId));
  }

  private async suspendPublishedDeployment(actorId: string, actorEmail: string, programId: string, scopeId: string): Promise<void> {
    const changed = await this.deploymentStore.suspendPublished(programId, scopeId);
    if (changed) {
      this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.suspended', targetType: 'governance_scope', targetId: scopeId, metadata: { programId, scopeId, reason: 'scope_inactive' } });
    }
  }

  private assertMetadataUpdateAllowed(metadata: Record<string, unknown>): void {
    const review = metadata.review;
    if (review && typeof review === 'object' && 'status' in review && (review as { status?: unknown }).status === 'approved') {
      throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
    }
  }

  /**
   * Web-source domain lists are stored normalized (lowercase hostnames, no
   * scheme/path). With web sources enabled but both lists empty, every web
   * source is authorized.
   */
  private normalizeKnowledge(knowledge: GovernanceScopeKnowledgeDto): GovernanceScopeKnowledge {
    const webSourcesEnabled = knowledge.webSourcesEnabled ?? false;
    return {
      sourceMode: knowledge.sourceMode ?? 'llm_only',
      webSourcesEnabled,
      webAllowedDomains: webSourcesEnabled ? this.normalizeDomainList(knowledge.webAllowedDomains, 'webAllowedDomains') : [],
      webBlockedDomains: webSourcesEnabled ? this.normalizeDomainList(knowledge.webBlockedDomains, 'webBlockedDomains') : [],
    };
  }

  private normalizeDomainList(values: string[] | undefined, field: string): string[] {
    if (!values?.length) return [];
    return values.map((value) => this.normalizeDomain(value, field));
  }

  private normalizeDomain(raw: string, field: string): string {
    const host = raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    const isValidHost = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);
    if (!isValidHost) {
      throw new ValidationException([{ field: `knowledge.${field}`, message: `"${raw.trim()}" is not a valid domain name`, value: raw }]);
    }
    return host;
  }

  private normalizeDescription(metadata: Record<string, unknown>): Record<string, unknown> {
    const description = metadata.description;
    if (description === undefined) return metadata;
    if (typeof description !== 'string' || description.length > 2000) {
      throw new ValidationException([{ field: 'metadata.description', message: 'Scope description must be a string of at most 2000 characters', value: description }]);
    }
    return { ...metadata, description: description.trim() };
  }

  private mergeMetadata(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
    const merged = { ...(current ?? {}) };
    for (const [key, value] of Object.entries(next)) {
      const existing = merged[key];
      merged[key] = this.isPlainObject(existing) && this.isPlainObject(value)
        ? this.mergeMetadata(existing, value)
        : value;
    }
    return merged;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
  }

  async countProgramScopes(programId: string, scopeIds: string[]): Promise<number> {
    const scopes = await this.scopeStore.listByProgram(programId, scopeIds);
    return scopes.length;
  }

  private async findOwnedScope(ownerUserId: string, programId: string, scopeId: string): Promise<GovernanceScopeRecord> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertScopeAccess(ownerUserId, programId, scopeId);
    const scope = await this.scopeStore.findByProgramAndId(programId, scopeId);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    return scope;
  }

  private async assertNoDuplicate(programId: string, name: string, excludeScopeId?: string): Promise<void> {
    const duplicates = await this.scopeStore.listByProgram(programId, '*');
    if (duplicates.some((scope) => scope.name === name && scope.id !== excludeScopeId)) {
      throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_NAME_EXISTS);
    }
  }

  private async assertScopeAccess(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(ownerUserId, programId);
    if (accessibleScopeIds.includes('*') || accessibleScopeIds.includes(scopeId)) return;
    throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
  }

  async getAccessibleScopeIds(ownerUserId: string, programId: string): Promise<string[]> {
    if (await this.isProgramOwner(ownerUserId, programId)) return ['*'];
    const groupIds = await this.userGroupService.findGroupIdsForMember(ownerUserId);
    const memberships = await this.membershipStore.findActiveForUser(programId, ownerUserId, groupIds);
    if (memberships.some((membership) => !membership.scopeId)) return ['*'];
    return memberships.map((membership) => membership.scopeId).filter((scopeId): scopeId is string => Boolean(scopeId));
  }

  private async isProgramOwner(ownerUserId: string, programId: string): Promise<boolean> {
    try {
      await this.programService.assertProgramOwner(ownerUserId, programId);
      return true;
    } catch (error) {
      error;
      return false;
    }
  }

  private async assertValidParent(programId: string, parentScopeId?: string, scopeId?: string): Promise<void> {
    if (!parentScopeId) return;
    if (scopeId && parentScopeId === scopeId) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_PARENT_INVALID);
    const parent = await this.scopeStore.findByProgramAndId(programId, parentScopeId);
    if (!parent) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_PARENT_INVALID);
    if (!scopeId) return;
    let cursor = parent.parentScopeId;
    while (cursor) {
      if (cursor === scopeId) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_PARENT_INVALID);
      const ancestor = await this.scopeStore.findByProgramAndId(programId, cursor);
      cursor = ancestor?.parentScopeId;
    }
  }

  private toResponse(scope: GovernanceScopeRecord): GovernanceScopeResponse {
    const knowledge = scope.knowledge ?? { sourceMode: 'llm_only' as const, webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] };
    return {
      id: scope.id,
      programId: scope.programId,
      parentScopeId: scope.parentScopeId,
      name: scope.name,
      type: scope.type,
      status: scope.status,
      agentIds: scope.agentIds ?? [],
      metadata: scope.metadata ?? {},
      knowledge: {
        sourceMode: knowledge.sourceMode ?? 'llm_only',
        webSourcesEnabled: knowledge.webSourcesEnabled ?? false,
        webAllowedDomains: knowledge.webAllowedDomains ?? [],
        webBlockedDomains: knowledge.webBlockedDomains ?? [],
      },
      createdAt: scope.createdAt instanceof Date ? scope.createdAt.toISOString() : String(scope.createdAt),
      updatedAt: scope.updatedAt instanceof Date ? scope.updatedAt.toISOString() : String(scope.updatedAt),
    };
  }
}
