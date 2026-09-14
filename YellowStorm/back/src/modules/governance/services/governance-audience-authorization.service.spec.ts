import { Types } from 'mongoose';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';

describe('GovernanceAudienceAuthorizationService', () => {
  const userId = new Types.ObjectId().toString();
  const scopeId = new Types.ObjectId().toString();
  const groupId = new Types.ObjectId().toString();
  const features = { isEnabled: jest.fn().mockReturnValue(true) };
  const groups = { findGroupIdsForMember: jest.fn() };

  function serviceWith(audience: Record<string, unknown> | null) {
    const exec = jest.fn().mockResolvedValue(audience ? { audience } : null);
    const scopeModel = { findOne: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec }) }) }) };
    return new GovernanceAudienceAuthorizationService(scopeModel as never, groups as never, features as never);
  }

  beforeEach(() => jest.clearAllMocks());

  it('allows every signed-in user for all_authenticated', async () => {
    await expect(serviceWith({ mode: 'all_authenticated', userIds: [], groupIds: [] }).isUserAuthorized(userId, scopeId)).resolves.toBe(true);
  });

  it('allows a directly listed restricted user', async () => {
    await expect(serviceWith({ mode: 'restricted', userIds: [new Types.ObjectId(userId)], groupIds: [] }).isUserAuthorized(userId, scopeId)).resolves.toBe(true);
  });

  it('allows a member of a listed restricted group', async () => {
    groups.findGroupIdsForMember.mockResolvedValue([groupId]);
    await expect(serviceWith({ mode: 'restricted', userIds: [], groupIds: [new Types.ObjectId(groupId)] }).isUserAuthorized(userId, scopeId)).resolves.toBe(true);
  });

  it('denies an empty restricted audience and inactive or missing scopes', async () => {
    groups.findGroupIdsForMember.mockResolvedValue([]);
    await expect(serviceWith({ mode: 'restricted', userIds: [], groupIds: [] }).isUserAuthorized(userId, scopeId)).resolves.toBe(false);
    await expect(serviceWith(null).isUserAuthorized(userId, scopeId)).resolves.toBe(false);
  });
});
