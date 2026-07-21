import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { Workspace, WorkspaceDocument } from '@modules/workspace/schemas/workspace.schema';
import { WorkspaceShare, WorkspaceShareDocument } from '@modules/workspace/schemas/workspace-share.schema';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import type { CreateGovernanceWorkspaceBindingDto, UpdateGovernanceWorkspaceBindingDto } from '../dto/create-governance-workspace-binding.dto';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

@Injectable()
export class GovernanceWorkspaceBindingService {
  constructor(
    @InjectModel(GovernanceWorkspaceBinding.name)
    private readonly bindingModel: Model<GovernanceWorkspaceBindingDocument>,
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(Workspace.name) private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceShare.name) private readonly shareModel: Model<WorkspaceShareDocument>,
    private readonly programs: GovernanceProgramService,
    private readonly access: GovernanceAccessService,
    private readonly draftPreparation: GovernanceDraftPreparationService,
  ) {}
  async create(actorId: string, programId: string, dto: CreateGovernanceWorkspaceBindingDto, actorEmail = ''): Promise<GovernanceWorkspaceBindingDocument> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const scopeIds = dto.scopeIds ?? [];
    if ((dto.visibility === 'program_shared' && scopeIds.length !== 0) || (dto.visibility === 'scope_specific' && scopeIds.length !== 1) || (dto.visibility === 'multi_scope' && scopeIds.length < 2)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Visibility and scope selection are inconsistent');
    if (dto.visibility === 'program_shared') await this.access.assertProgramWideAccess(actorId, programId);
    else await this.access.assertScopeSelection(actorId, programId, scopeIds);
    const workspace = await this.workspaceModel.findById(dto.workspaceId).exec();
    if (!workspace) throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    const canRead =
      workspace.createdBy.equals(actorId) ||
      workspace.isPublic ||
      Boolean(
        await this.shareModel.exists({
          workspaceId: workspace._id,
          sharedWithUserId: new Types.ObjectId(actorId),
        }),
      );
    if (!canRead) throw new ForbiddenException(ErrorCode.WORKSPACE_FORBIDDEN, 'Read access to the workspace is required');
    const existingBinding = await this.bindingModel
      .findOne({
        programId: new Types.ObjectId(programId),
        workspaceId: new Types.ObjectId(dto.workspaceId),
      })
      .exec();
    if (existingBinding) {
      return this.connectExistingBinding(actorId, actorEmail, programId, existingBinding, dto.visibility, scopeIds);
    }
    try {
      const binding = await this.bindingModel.create({
        programId: new Types.ObjectId(programId),
        workspaceId: new Types.ObjectId(dto.workspaceId),
        visibility: dto.visibility,
        scopeIds: scopeIds.map((id) => new Types.ObjectId(id)),
        ingestionMode: dto.ingestionMode ?? 'assisted',
        defaults: dto.defaults ?? {},
        createdBy: new Types.ObjectId(actorId),
      });
      const affectedScopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, scopeIds);
      await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
      return binding;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Workspace is already bound to this program');
      throw error;
    }
  }
  async list(actorId: string, programId: string): Promise<GovernanceWorkspaceBindingDocument[]> {
    await this.programs.assertOwnedProgram(actorId, programId);
    return this.bindingModel
      .find({ programId: new Types.ObjectId(programId) })
      .sort({ createdAt: -1 })
      .exec();
  }
  async find(actorId: string, programId: string, bindingId: string): Promise<GovernanceWorkspaceBindingDocument> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const binding = await this.bindingModel
      .findOne({
        _id: this.objectId(bindingId, 'bindingId'),
        programId: new Types.ObjectId(programId),
      })
      .exec();
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    return binding;
  }
  async enabledForWorkspace(workspaceId: string): Promise<GovernanceWorkspaceBindingDocument[]> {
    return this.bindingModel.find({ workspaceId: this.objectId(workspaceId, 'workspaceId'), enabled: true }).exec();
  }
  async update(actorId: string, programId: string, bindingId: string, dto: UpdateGovernanceWorkspaceBindingDto, actorEmail = ''): Promise<GovernanceWorkspaceBindingDocument> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const binding = await this.bindingModel
      .findOne({
        _id: this.objectId(bindingId, 'bindingId'),
        programId: new Types.ObjectId(programId),
      })
      .exec();
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    if (dto.enabled !== undefined) binding.enabled = dto.enabled;
    if (dto.ingestionMode) binding.ingestionMode = dto.ingestionMode;
    if (dto.defaults) binding.defaults = dto.defaults;
    await binding.save();
    const affectedScopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, binding.scopeIds.map(String));
    await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
    return binding;
  }
  async delete(actorId: string, programId: string, bindingId: string, actorEmail = ''): Promise<void> {
    const binding = await this.find(actorId, programId, bindingId);
    const scopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, binding.scopeIds.map(String));
    await binding.deleteOne();
    await Promise.all(scopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
  }
  async assertAccessible(actorId: string, programId: string, bindingId: string): Promise<void> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const binding = await this.bindingModel.exists({
      _id: this.objectId(bindingId, 'bindingId'),
      programId: new Types.ObjectId(programId),
    });
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
  }
  private objectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `${field} must be a valid identifier`);
    return new Types.ObjectId(value);
  }
  private async resolveAffectedScopeIds(programId: string, visibility: string, scopeIds: string[]): Promise<string[]> {
    if (visibility !== 'program_shared') return [...new Set(scopeIds)];
    const scopes = await this.scopeModel
      .find({ programId: new Types.ObjectId(programId), status: { $ne: 'archived' } })
      .select('_id')
      .lean()
      .exec();
    return scopes.map((scope) => scope._id.toString());
  }

  private async connectExistingBinding(actorId: string, actorEmail: string, programId: string, binding: GovernanceWorkspaceBindingDocument, requestedVisibility: CreateGovernanceWorkspaceBindingDto['visibility'], requestedScopeIds: string[]): Promise<GovernanceWorkspaceBindingDocument> {
    const existingScopeIds = binding.scopeIds.map(String);
    if (binding.visibility === 'program_shared' || requestedVisibility === 'program_shared') {
      await this.access.assertProgramWideAccess(actorId, programId);
    } else {
      await this.access.assertScopeSelection(actorId, programId, [...new Set([...existingScopeIds, ...requestedScopeIds])]);
    }
    const previousScopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, existingScopeIds);
    if (binding.visibility !== 'program_shared') {
      if (requestedVisibility === 'program_shared') {
        binding.visibility = 'program_shared';
        binding.scopeIds = [];
      } else {
        const scopeIds = [...new Set([...binding.scopeIds.map(String), ...requestedScopeIds])];
        binding.scopeIds = scopeIds.map((scopeId) => new Types.ObjectId(scopeId));
        binding.visibility = scopeIds.length === 1 ? 'scope_specific' : 'multi_scope';
      }
    }
    binding.enabled = true;
    await binding.save();
    const nextScopeIds = await this.resolveAffectedScopeIds(programId, binding.visibility, binding.scopeIds.map(String));
    const affectedScopeIds = [...new Set([...previousScopeIds, ...nextScopeIds])];
    await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId)));
    return binding;
  }
}
