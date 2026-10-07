import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {     type GovernanceBindingRecord,       PASSTHROUGH_TRANSACTION} from '../persistence';
import { DuplicateKeyError } from '../persistence/governance-records';
import type { CreateGovernanceWorkspaceBindingDto, UpdateGovernanceWorkspaceBindingDto } from '../dto/create-governance-workspace-binding.dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';
import { PgWorkspaceReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-read.adapter';
import { PgWorkspaceShareReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-share-read.adapter';
import { PgGovernanceTransactionRunner } from '../persistence/postgres/pg-transaction-runner';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';

@Injectable()
export class GovernanceWorkspaceBindingService {
  constructor(
    private readonly bindingStore: PgBindingStore,
    private readonly scopeStore: PgScopeStore,
    private readonly workspaceReadPort: PgWorkspaceReadAdapter,
    private readonly shareReadPort: PgWorkspaceShareReadAdapter,
    private readonly programs: GovernanceProgramService,
    private readonly access: GovernanceAccessService,
    private readonly draftPreparation: GovernanceDraftPreparationService,
    private readonly tx: PgGovernanceTransactionRunner = PASSTHROUGH_TRANSACTION as unknown as PgGovernanceTransactionRunner,
  ) {}
  async create(actorId: string, programId: string, dto: CreateGovernanceWorkspaceBindingDto, actorEmail = ''): Promise<GovernanceBindingRecord> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const scopeIds = dto.scopeIds ?? [];
    if ((dto.visibility === 'program_shared' && scopeIds.length !== 0) || (dto.visibility === 'scope_specific' && scopeIds.length !== 1) || (dto.visibility === 'multi_scope' && scopeIds.length < 2)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Visibility and scope selection are inconsistent');
    if (dto.visibility === 'program_shared') await this.access.assertProgramWideAccess(actorId, programId);
    else await this.access.assertScopeSelection(actorId, programId, scopeIds);
    const workspace = await this.workspaceReadPort.findById(dto.workspaceId);
    if (!workspace) throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    const canRead =
      workspace.createdBy === actorId ||
      workspace.isPublic ||
      Boolean(await this.shareReadPort.permissionFor(workspace.id, actorId));
    if (!canRead) throw new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN, 'Read access to the workspace is required');
    const existingBinding = await this.bindingStore.findByProgramAndWorkspace(programId, dto.workspaceId);
    if (existingBinding) {
      return this.connectExistingBinding(actorId, actorEmail, programId, existingBinding, dto.visibility, scopeIds);
    }
    try {
      const binding = await this.bindingStore.insert({
        programId,
        workspaceId: dto.workspaceId,
        visibility: dto.visibility,
        scopeIds,
        ingestionMode: dto.ingestionMode ?? 'assisted',
        defaults: dto.defaults ?? {},
        createdBy: actorId,
      });
      const affectedScopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, scopeIds);
      await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
      return binding;
    } catch (error) {
      if (error instanceof DuplicateKeyError) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Workspace is already bound to this program');
      throw error;
    }
  }
  async list(actorId: string, programId: string): Promise<GovernanceBindingRecord[]> {
    await this.programs.assertOwnedProgram(actorId, programId);
    return this.bindingStore.listByProgram(programId);
  }
  async find(actorId: string, programId: string, bindingId: string): Promise<GovernanceBindingRecord> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const binding = await this.bindingStore.findByIdAndProgram(programId, bindingId);
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    return binding;
  }
  async enabledForWorkspace(workspaceId: string): Promise<GovernanceBindingRecord[]> {
    return this.bindingStore.listEnabledForWorkspace(workspaceId);
  }
  async update(actorId: string, programId: string, bindingId: string, dto: UpdateGovernanceWorkspaceBindingDto, actorEmail = ''): Promise<GovernanceBindingRecord> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const binding = await this.bindingStore.findByIdAndProgram(programId, bindingId);
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    const updated = await this.bindingStore.update(binding.id, {
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.ingestionMode ? { ingestionMode: dto.ingestionMode } : {}),
      ...(dto.defaults ? { defaults: dto.defaults } : {}),
    });
    if (!updated) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    const affectedScopeIds = await this.resolveAffectedScopeIds(programId, updated.visibility, updated.scopeIds);
    await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
    return updated;
  }
  async delete(actorId: string, programId: string, bindingId: string, actorEmail = ''): Promise<void> {
    const binding = await this.find(actorId, programId, bindingId);
    const scopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, binding.scopeIds);
    await this.bindingStore.deleteById(binding.id);
    await Promise.all(scopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
  }
  async assertAccessible(actorId: string, programId: string, bindingId: string): Promise<void> {
    await this.programs.assertOwnedProgram(actorId, programId);
    if (!(await this.bindingStore.existsByIdAndProgram(programId, bindingId))) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
  }
  private async resolveAffectedScopeIds(programId: string, visibility: string, scopeIds: string[]): Promise<string[]> {
    if (visibility !== 'program_shared') return [...new Set(scopeIds)];
    const scopes = await this.scopeStore.listByProgram(programId, '*');
    // The Mongo filter excluded a legacy 'archived' status scopes no longer carry.
    return scopes.map((scope) => scope.id);
  }

  private async connectExistingBinding(actorId: string, actorEmail: string, programId: string, binding: GovernanceBindingRecord, requestedVisibility: CreateGovernanceWorkspaceBindingDto['visibility'], requestedScopeIds: string[]): Promise<GovernanceBindingRecord> {
    const existingScopeIds = binding.scopeIds;
    if (binding.visibility === 'program_shared' || requestedVisibility === 'program_shared') {
      await this.access.assertProgramWideAccess(actorId, programId);
    } else {
      await this.access.assertScopeSelection(actorId, programId, [...new Set([...existingScopeIds, ...requestedScopeIds])]);
    }
    const previousScopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, existingScopeIds);
    let nextVisibility = binding.visibility;
    let nextScopeIds = binding.scopeIds;
    if (binding.visibility !== 'program_shared') {
      if (requestedVisibility === 'program_shared') {
        nextVisibility = 'program_shared';
        nextScopeIds = [];
      } else {
        const scopeIds = [...new Set([...binding.scopeIds, ...requestedScopeIds])];
        nextScopeIds = scopeIds;
        nextVisibility = scopeIds.length === 1 ? 'scope_specific' : 'multi_scope';
      }
    }
    // Re-enable and scope replacement commit together (draft preparation stays outside).
    const refreshed = await this.tx.run(async () => {
      const updated = await this.bindingStore.update(binding.id, { enabled: true });
      if (!updated) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
      if (nextVisibility !== binding.visibility || nextScopeIds !== binding.scopeIds) {
        await this.bindingStore.replaceScopeIds(binding.id, nextScopeIds, nextVisibility);
      }
      return (await this.bindingStore.findById(binding.id)) ?? updated;
    });
    const nextAffectedScopeIds = await this.resolveAffectedScopeIds(programId, refreshed.visibility, refreshed.scopeIds);
    const affectedScopeIds = [...new Set([...previousScopeIds, ...nextAffectedScopeIds])];
    await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
    return refreshed;
  }
}
