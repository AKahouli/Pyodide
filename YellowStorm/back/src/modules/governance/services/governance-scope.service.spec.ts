import { ForbiddenException } from '@modules/exceptions';
import { GovernanceScopeService } from './governance-scope.service';

const actorId = '507f1f77bcf86cd799439011';
const programId = '507f1f77bcf86cd799439012';
const scopeId = '507f1f77bcf86cd799439013';

function queryResult<T>(value: T) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('GovernanceScopeService delete authorization', () => {
  function buildService(options: { isOwner?: boolean; accessibleScopeIds?: string[]; deleteMembership?: unknown } = {}) {
    const scope = { _id: { toString: () => scopeId }, programId: { toString: () => programId }, name: 'Scope' };
    const scopeModel = {
      findOne: jest.fn().mockReturnValue(queryResult(scope)),
      countDocuments: jest.fn().mockResolvedValue(0),
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    const sourceModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    const membershipModel = {
      find: jest.fn().mockReturnValue(queryResult((options.accessibleScopeIds ?? [scopeId]).map((id) => ({ scopeId: { toString: () => id } })))),
      findOne: jest.fn().mockReturnValue(queryResult(options.deleteMembership ?? null)),
    };
    const programService = {
      assertOwnedProgram: jest.fn().mockResolvedValue(undefined),
      assertProgramOwner: jest.fn().mockImplementation(async () => {
        if (!options.isOwner) throw new Error('not owner');
      }),
    };
    const service = new GovernanceScopeService(scopeModel as never, sourceModel as never, membershipModel as never, programService as never);
    return { service, scopeModel };
  }

  it('allows the program owner to delete a scope', async () => {
    const { service, scopeModel } = buildService({ isOwner: true });

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalled();
  });

  it('allows a program admin to delete any accessible scope', async () => {
    const { service, scopeModel } = buildService({ accessibleScopeIds: ['*'], deleteMembership: { _id: 'membership-1' } });

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalled();
  });

  it('allows a scope admin to delete their scope', async () => {
    const { service, scopeModel } = buildService({ deleteMembership: { _id: 'membership-1' } });

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalled();
  });

  it('rejects lower scope roles even when they can access the scope', async () => {
    const { service, scopeModel } = buildService();

    await expect(service.delete(actorId, programId, scopeId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(scopeModel.deleteOne).not.toHaveBeenCalled();
  });
});
