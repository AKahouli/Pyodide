import { Types } from 'mongoose';
import { ForbiddenException } from '@modules/exceptions';
import type { WorkspaceReadPort, WorkspaceShareReadPort } from '@modules/workspace/ports';
import { GovernanceWorkspaceBindingService } from './governance-workspace-binding.service';
import type { GovernanceProgramService } from './governance-program.service';
import type { GovernanceAccessService } from './governance-access.service';
import type { GovernanceDraftPreparationService } from './governance-draft-preparation.service';
import type { BindingStore, ScopeStore } from '../persistence';

describe('GovernanceWorkspaceBindingService', () => {
  const actorId = new Types.ObjectId().toString();
  const programId = new Types.ObjectId().toString();
  const scopeId = new Types.ObjectId().toString();
  const workspaceId = new Types.ObjectId().toString();

  function bindingRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: new Types.ObjectId().toString(),
      programId,
      workspaceId,
      visibility: 'scope_specific',
      scopeIds: [scopeId],
      enabled: true,
      ingestionMode: 'assisted',
      defaults: {},
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

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
      id: workspaceId,
      createdBy: options.owner ? actorId : new Types.ObjectId().toString(),
      isPublic: options.isPublic ?? false,
    };
    const binding = bindingRecord({
      visibility: options.existingVisibility ?? 'scope_specific',
      scopeIds: options.existingVisibility === 'program_shared' ? [] : [options.existingScopeId ?? scopeId],
      enabled: options.existingEnabled ?? true,
    });
    let replaced: Record<string, unknown> | undefined;
    const bindingStore = {
      insert: jest.fn().mockResolvedValue(bindingRecord()),
      findByProgramAndWorkspace: jest.fn().mockResolvedValue(options.existingScopeId ? binding : null),
      update: jest.fn().mockResolvedValue(binding),
      findById: jest.fn().mockImplementation(async () => replaced ?? binding),
      replaceScopeIds: jest.fn().mockImplementation(async (_id: string, scopeIds: string[], visibility: string) => {
        replaced = bindingRecord({ scopeIds, visibility });
        return replaced;
      }),
    };
    const scopeStore: Partial<ScopeStore> = { listByProgram: jest.fn().mockResolvedValue([]) };
    const workspaceReadPort = { findById: jest.fn().mockResolvedValue(workspace) };
    const shareReadPort = { permissionFor: jest.fn().mockResolvedValue(options.shared ? 'read' : null) };
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
      bindingStore as unknown as BindingStore,
      scopeStore as unknown as ScopeStore,
      workspaceReadPort as unknown as WorkspaceReadPort,
      shareReadPort as unknown as WorkspaceShareReadPort,
      programs as unknown as GovernanceProgramService,
      access as unknown as GovernanceAccessService,
      draftPreparation as unknown as GovernanceDraftPreparationService,
    );
    return { service, binding, bindingStore, shareReadPort, draftPreparation, access };
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
    const { service, bindingStore, draftPreparation } = buildService(options);

    await expect(
      service.create(actorId, programId, payload(), 'owner@example.test'),
    ).resolves.toBeDefined();

    expect(bindingStore.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId }),
    );
    expect(draftPreparation.prepare).toHaveBeenCalledWith(
      actorId,
      'owner@example.test',
      programId,
      scopeId,
    );
  });

  it('rejects a private workspace the actor cannot read', async () => {
    const { service, bindingStore, shareReadPort } = buildService();

    await expect(service.create(actorId, programId, payload())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(shareReadPort.permissionFor).toHaveBeenCalledWith(workspaceId, actorId);
    expect(bindingStore.insert).not.toHaveBeenCalled();
  });

  it('extends an existing workspace binding to the selected scope', async () => {
    const existingScopeId = new Types.ObjectId().toString();
    const { service, bindingStore, draftPreparation } = buildService({
      owner: true,
      existingScopeId,
    });

    const result = await service.create(actorId, programId, payload(), 'owner@example.test');

    expect(bindingStore.insert).not.toHaveBeenCalled();
    expect(bindingStore.replaceScopeIds).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([existingScopeId, scopeId]),
      'multi_scope',
    );
    expect(result.visibility).toBe('multi_scope');
    expect(result.scopeIds).toEqual(expect.arrayContaining([existingScopeId, scopeId]));
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
    const { service, bindingStore } = buildService({
      owner: true,
      existingScopeId: new Types.ObjectId().toString(),
      fullScopeAccess: false,
    });

    await expect(service.create(actorId, programId, payload())).rejects.toThrow(
      'Scope access denied',
    );

    expect(bindingStore.update).not.toHaveBeenCalled();
    expect(bindingStore.insert).not.toHaveBeenCalled();
  });

  it('does not reactivate a program-wide binding without program-wide access', async () => {
    const { service, binding, bindingStore } = buildService({
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
    expect(bindingStore.update).not.toHaveBeenCalled();
  });
});
