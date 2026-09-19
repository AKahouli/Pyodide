import { Types } from 'mongoose';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';

describe('GovernanceAudienceAuthorizationService', () => {
  const userId = new Types.ObjectId().toString();
  const scopeId = new Types.ObjectId().toString();
  const groupId = new Types.ObjectId().toString();
  const features = { isEnabled: jest.fn().mockReturnValue(true) };
  const groups = { findGroupIdsForMember: jest.fn() };

  function serviceWith(scope: Record<string, unknown> | null) {
    const scopeStore = { findById: jest.fn().mockResolvedValue(scope) };
    return new GovernanceAudienceAuthorizationService(scopeStore as never, groups as never, features as never);
  }

  beforeEach(() => jest.clearAllMocks());

  it('allows every signed-in user for all_authenticated', async () => {
    const scope = { id: scopeId, status: 'active', audience: { mode: 'all_authenticated', userIds: [], groupIds: [] } };
    await expect(serviceWith(scope).isUserAuthorized(userId, scopeId)).resolves.toBe(true);
  });

  it('allows a directly listed restricted user', async () => {
    const scope = { id: scopeId, status: 'active', audience: { mode: 'restricted', userIds: [userId], groupIds: [] } };
    await expect(serviceWith(scope).isUserAuthorized(userId, scopeId)).resolves.toBe(true);
  });

  it('allows a member of a listed restricted group', async () => {
    groups.findGroupIdsForMember.mockResolvedValue([groupId]);
    const scope = { id: scopeId, status: 'active', audience: { mode: 'restricted', userIds: [], groupIds: [groupId] } };
    await expect(serviceWith(scope).isUserAuthorized(userId, scopeId)).resolves.toBe(true);
  });

  it('denies an empty restricted audience and inactive or missing scopes', async () => {
    groups.findGroupIdsForMember.mockResolvedValue([]);
    const emptyRestricted = { id: scopeId, status: 'active', audience: { mode: 'restricted', userIds: [], groupIds: [] } };
    await expect(serviceWith(emptyRestricted).isUserAuthorized(userId, scopeId)).resolves.toBe(false);
    await expect(serviceWith(null).isUserAuthorized(userId, scopeId)).resolves.toBe(false);
    await expect(serviceWith({ id: scopeId, status: 'inactive', audience: { mode: 'all_authenticated', userIds: [], groupIds: [] } }).isUserAuthorized(userId, scopeId)).resolves.toBe(false);
  });
});
