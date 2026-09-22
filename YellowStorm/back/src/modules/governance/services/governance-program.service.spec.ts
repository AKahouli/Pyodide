import { ForbiddenException } from '@modules/exceptions';
import { GovernanceProgramService } from './governance-program.service';

const actorId = '507f1f77bcf86cd799439011';
const programId = '507f1f77bcf86cd799439012';
const otherUserId = '507f1f77bcf86cd799439013';

describe('GovernanceProgramService delete authorization', () => {
  function buildService(ownerUserId = actorId, memberships: unknown[] = []) {
    const program = { id: programId, ownerUserId, name: 'Program', defaultLanguage: 'fr', status: 'draft', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const programStore = { findById: jest.fn().mockResolvedValue(program), deleteById: jest.fn().mockResolvedValue(undefined), findByOwnerAndId: jest.fn().mockResolvedValue(program) };
    const scopeStore = { countByProgram: jest.fn().mockResolvedValue(0) };
    const documentStore = { countByProgram: jest.fn().mockResolvedValue(0) };
    const bindingStore = { countByProgram: jest.fn().mockResolvedValue(0) };
    const membershipStore = { findActiveForUser: jest.fn().mockResolvedValue(memberships), findActiveByUser: jest.fn().mockResolvedValue([]) };
    const service = new GovernanceProgramService(programStore as never, scopeStore as never, documentStore as never, bindingStore as never, membershipStore as never);
    return { service, programStore };
  }

  it('allows the program owner to delete an empty program', async () => {
    const { service, programStore } = buildService();

    await service.delete(actorId, programId);

    expect(programStore.deleteById).toHaveBeenCalledWith(programId);
  });

  it('allows a program admin to delete an empty program', async () => {
    const { service, programStore } = buildService(otherUserId, [{ programId, userId: actorId, scopeId: null, role: 'program_admin' }]);

    await service.delete(actorId, programId);

    expect(programStore.deleteById).toHaveBeenCalledWith(programId);
  });

  it('rejects non-owner users without a program admin membership', async () => {
    const { service, programStore } = buildService(otherUserId);

    await expect(service.delete(actorId, programId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(programStore.deleteById).not.toHaveBeenCalled();
  });
});
