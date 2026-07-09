import { ForbiddenException } from '@modules/exceptions';
import { GovernanceProgramService } from './governance-program.service';

const actorId = '507f1f77bcf86cd799439011';
const programId = '507f1f77bcf86cd799439012';
const otherUserId = '507f1f77bcf86cd799439013';

function queryResult<T>(value: T) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('GovernanceProgramService delete authorization', () => {
  function buildService(ownerUserId = actorId, membership: unknown = null) {
    const program = { _id: { toString: () => programId }, ownerUserId: { toString: () => ownerUserId } };
    const programModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(program) }), deleteOne: jest.fn().mockResolvedValue({}) };
    const scopeModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    const sourceModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    const membershipModel = { findOne: jest.fn().mockReturnValue(queryResult(membership)) };
    const service = new GovernanceProgramService(programModel as never, scopeModel as never, sourceModel as never, membershipModel as never);
    return { service, programModel };
  }

  it('allows the program owner to delete an empty program', async () => {
    const { service, programModel } = buildService();

    await service.delete(actorId, programId);

    expect(programModel.deleteOne).toHaveBeenCalled();
  });

  it('allows a program admin to delete an empty program', async () => {
    const { service, programModel } = buildService(otherUserId, { _id: 'membership-1' });

    await service.delete(actorId, programId);

    expect(programModel.deleteOne).toHaveBeenCalled();
  });

  it('rejects non-owner users without a program admin membership', async () => {
    const { service, programModel } = buildService(otherUserId);

    await expect(service.delete(actorId, programId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(programModel.deleteOne).not.toHaveBeenCalled();
  });
});
