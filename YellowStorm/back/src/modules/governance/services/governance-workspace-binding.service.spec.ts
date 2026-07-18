import { Types, type Model } from 'mongoose';
import { ForbiddenException } from '@modules/exceptions';
import type { WorkspaceDocument } from '@modules/workspace/schemas/workspace.schema';
import type { WorkspaceShareDocument } from '@modules/workspace/schemas/workspace-share.schema';
import type { GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import type { GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceWorkspaceBindingService } from './governance-workspace-binding.service';
import type { GovernanceProgramService } from './governance-program.service';
import type { GovernanceAccessService } from './governance-access.service';
import type { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

describe('GovernanceWorkspaceBindingService', () => {
  const actorId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const scopeId = new Types.ObjectId().toString();
  const workspaceId = new Types.ObjectId().toString();

  function buildService(
    options: {
      owner?: boolean;
      isPublic?: boolean;
      shared?: boolean;
      existingScopeId?: string;
      existingVisibility?: 'scope_specific' | 'multi_scope' | 'program_shared';
      existingEnabled?: boolean;
      fullScopeAccess?: boolean;
      programWideAccess?: boolean;
    } = {},
  ) {
    const workspace = {
      _id: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(options.owner ? actorId : new Types.ObjectId().toString()),
      isPublic: options.isPublic ?? false,
    };
    const binding = {
      _id: new Types.ObjectId(),
      visibility: options.existingVisibility ?? 'scope_specific',
      scopeIds:
        options.existingVisibility === 'program_shared'
          ? []
          : [new Types.ObjectId(options.existingScopeId ?? scopeId)],
      enabled: options.existingEnabled ?? true,
      save: jest.fn().mockResolvedValue(undefined),
      deleteOne: jest.fn(),
    };
    const bindingModel = {
      create: jest.fn().mockResolvedValue(binding),
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(options.existingScopeId ? binding : null),
      }),
    };
    const scopeModel = { find: jest.fn() };
    const workspaceModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(workspace) }),
    };
    const shareModel = { exists: jest.fn().mockResolvedValue(options.shared ?? false) };
    const programs = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) };
    const access = {
      assertScopeSelection: jest
        .fn()
        .mockImplementation((_actorId: string, _programId: string, scopeIds: string[]) =>
          options.fullScopeAccess === false && scopeIds.length > 1
            ? Promise.reject(new Error('Scope access denied'))
            : Promise.resolve(),
        ),
      assertProgramWideAccess: jest
        .fn()
        .mockImplementation(() =>
          options.programWideAccess === false
            ? Promise.reject(new Error('Program access denied'))
            : Promise.resolve(),
        ),
    };
    const draftPreparation = { prepare: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceWorkspaceBindingService(
      bindingModel as unknown as Model<GovernanceWorkspaceBindingDocument>,
      scopeModel as unknown as Model<GovernanceScopeDocument>,
      workspaceModel as unknown as Model<WorkspaceDocument>,
      shareModel as unknown as Model<WorkspaceShareDocument>,
      programs as unknown as GovernanceProgramService,
      access as unknown as GovernanceAccessService,
      draftPreparation as unknown as GovernanceDraftPreparationService,
    );
    return { service, binding, bindingModel, shareModel, draftPreparation, access };
  }

  const payload = () => ({
    workspaceId,
    visibility: 'scope_specific' as const,
    scopeIds: [scopeId],
    ingestionMode: 'assisted' as const,
  });

  it.each([
    ['an owned workspace', { owner: true }],
    ['a public workspace', { isPublic: true }],
    ['a workspace shared with read access', { shared: true }],
  ])('connects %s', async (_label, options) => {
    const { service, bindingModel, draftPreparation } = buildService(options);

    await expect(
      service.create(actorId, programId, payload(), 'owner@example.test'),
    ).resolves.toBeDefined();

    expect(bindingModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: new Types.ObjectId(workspaceId) }),
    );
    expect(draftPreparation.prepare).toHaveBeenCalledWith(
      actorId,
      'owner@example.test',
      programId,
      scopeId,
    );
  });

  it('rejects a private workspace the actor cannot read', async () => {
    const { service, bindingModel, shareModel } = buildService();

    await expect(service.create(actorId, programId, payload())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(shareModel.exists).toHaveBeenCalledWith({
      workspaceId: new Types.ObjectId(workspaceId),
      sharedWithUserId: new Types.ObjectId(actorId),
    });
    expect(bindingModel.create).not.toHaveBeenCalled();
  });

  it('extends an existing workspace binding to the selected scope', async () => {
    const existingScopeId = new Types.ObjectId().toString();
    const { service, bindingModel, draftPreparation } = buildService({
      owner: true,
      existingScopeId,
    });

    const result = await service.create(actorId, programId, payload(), 'owner@example.test');

    expect(bindingModel.create).not.toHaveBeenCalled();
    expect(result.visibility).toBe('multi_scope');
    expect(result.scopeIds.map(String)).toEqual(expect.arrayContaining([existingScopeId, scopeId]));
    expect(result.save).toHaveBeenCalled();
    expect(draftPreparation.prepare).toHaveBeenCalledWith(
      actorId,
      'owner@example.test',
      programId,
      existingScopeId,
    );
    expect(draftPreparation.prepare).toHaveBeenCalledWith(
      actorId,
      'owner@example.test',
      programId,
      scopeId,
    );
  });

  it('does not extend a binding when the actor lacks access to its existing scopes', async () => {
    const { service, binding, bindingModel } = buildService({
      owner: true,
      existingScopeId: new Types.ObjectId().toString(),
      fullScopeAccess: false,
    });

    await expect(service.create(actorId, programId, payload())).rejects.toThrow(
      'Scope access denied',
    );

    expect(binding.save).not.toHaveBeenCalled();
    expect(bindingModel.create).not.toHaveBeenCalled();
  });

  it('does not reactivate a program-wide binding without program-wide access', async () => {
    const { service, binding } = buildService({
      owner: true,
      existingScopeId: new Types.ObjectId().toString(),
      existingVisibility: 'program_shared',
      existingEnabled: false,
      programWideAccess: false,
    });

    await expect(service.create(actorId, programId, payload())).rejects.toThrow(
      'Program access denied',
    );

    expect(binding.enabled).toBe(false);
    expect(binding.save).not.toHaveBeenCalled();
  });
});
