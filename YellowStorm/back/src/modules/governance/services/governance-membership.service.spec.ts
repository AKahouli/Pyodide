import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceMembershipService } from './governance-membership.service';

describe('GovernanceMembershipService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const programId = '507f1f77bcf86cd799439012';
  const userId = '507f1f77bcf86cd799439013';

  function buildService(duplicate?: Record<string, unknown>) {
    const membershipModel = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(duplicate ?? null) }) }),
      create: jest.fn().mockImplementation(async (payload) => ({ _id: { toString: () => 'membership-1' }, ...payload, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') })),
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
    };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined), assertProgramOwner: jest.fn().mockResolvedValue(undefined) };
    const scopeService = { findById: jest.fn().mockResolvedValue({}) };
    const auditLogService = { logSuccess: jest.fn() };
    return new GovernanceMembershipService(membershipModel as never, programService as never, scopeService as never, auditLogService as never);
  }

  it('creates active memberships with role permissions', async () => {
    const service = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_viewer' });

    expect(membership.userId).toBe(userId);
    expect(membership.status).toBe('active');
    expect(membership.permissions).toContain('governance.read');
  });

  it('rejects duplicate memberships for the same program scope and user', async () => {
    const service = buildService({ _id: 'existing' });

    await expect(service.create(actorId, actorEmail, programId, { userId, role: 'scope_viewer' })).rejects.toMatchObject({ code: ErrorCode.GOVERNANCE_MEMBERSHIP_EXISTS });
    await expect(service.create(actorId, actorEmail, programId, { userId, role: 'scope_viewer' })).rejects.toBeInstanceOf(ConflictException);
  });
});
