import { Types } from 'mongoose';
import { GovernanceScopeOverviewService } from './governance-scope-overview.service';

const query = <T>(value: T) => ({ sort: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) });

describe('GovernanceScopeOverviewService', () => {
  it('returns binding-grouped workspaces and joined governed documents', async () => {
    const programId = new Types.ObjectId();
    const scopeId = new Types.ObjectId();
    const workspaceId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const scope = { _id: scopeId, programId, name: 'Courbevoie', type: 'commune', status: 'active', agentIds: [], audience: { mode: 'all_authenticated' }, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const binding = { _id: new Types.ObjectId(), workspaceId, visibility: 'scope_specific', scopeIds: [scopeId], ingestionMode: 'assisted' };
    const governance = { _id: new Types.ObjectId(), programId, workspaceId, documentId, status: 'captured', validity: { businessStatus: 'valid' }, tags: [], metadata: {}, updatedAt: new Date() };
    const artifact = { _id: documentId, workspaceId, originalName: 'Policy.pdf', mimeType: 'application/pdf', type: 'doc', status: 'completed', indexingStatus: 'ready', updatedAt: new Date() };
    const service = new GovernanceScopeOverviewService(
      { findOne: jest.fn(() => query(scope)) } as never,
      { find: jest.fn(() => query([governance])) } as never,
      { find: jest.fn(() => query([artifact])) } as never,
      { find: jest.fn(() => query([binding])) } as never,
      { findOne: jest.fn(() => query(null)) } as never,
      { findById: jest.fn(() => query(null)) } as never,
      { findOne: jest.fn(() => query(null)) } as never,
      { find: jest.fn(() => query([])) } as never,
      { find: jest.fn(() => query([])) } as never,
      { find: jest.fn(() => query([])) } as never,
      { find: jest.fn(() => query([])) } as never,
      { assertOwnedProgram: jest.fn() } as never,
      { assertScopeAccess: jest.fn(), canActInScopeRole: jest.fn().mockResolvedValue(false) } as never,
    );

    const result = await service.getOverview(new Types.ObjectId().toString(), programId.toString(), scopeId.toString());

    expect(result.knowledge.sharedWorkspaces).toEqual([]);
    expect(result.knowledge.localWorkspaces).toHaveLength(1);
    expect(result.knowledge.documents[0]).toEqual(expect.objectContaining({ documentId: documentId.toString(), document: expect.objectContaining({ indexingStatus: 'ready' }) }));
    expect(result.readiness.checks).toContainEqual(expect.objectContaining({ key: 'knowledge_mapped', status: 'passed', targetType: 'document' }));
  });
});
