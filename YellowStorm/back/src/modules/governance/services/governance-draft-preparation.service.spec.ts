import { Types } from 'mongoose';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

describe('GovernanceDraftPreparationService', () => {
  it('creates an immutable workspace-centric draft for a changed configuration', async () => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const deploymentId = new Types.ObjectId().toString();
    const agentId = new Types.ObjectId().toString();
    const workspaceId = new Types.ObjectId().toString();
    const createdRevisionId = new Types.ObjectId().toString();
    const previousDraftId = new Types.ObjectId().toString();
    const scope = { id: scopeId, name: 'Scope', type: 'custom', status: 'active', agentIds: [agentId], metadata: { classification: { stage: 'pilot' } }, audience: { mode: 'restricted', userIds: [], groupIds: [] } };
    const deployment = { id: deploymentId, status: 'published', channels: {}, revisionSequence: 1, currentDraftRevisionId: previousDraftId };
    const scopeStore = {
      findByProgramAndId: jest.fn().mockResolvedValue(scope),
      setMetadataReviewStatus: jest.fn().mockResolvedValue(undefined),
    };
    const bindingStore = {
      listEnabled: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), workspaceId, visibility: 'scope_specific', ingestionMode: 'assisted', defaults: {} }]),
    };
    let currentDraft: Record<string, any> | null = { id: previousDraftId, status: 'published', previousAudienceSnapshot: {} };
    const deploymentStore = {
      findByProgramAndScope: jest.fn().mockResolvedValue(deployment),
      maxRevisionSequence: jest.fn(),
      incrementRevisionSequenceGuarded: jest.fn().mockImplementation(async () => ({ ...deployment, revisionSequence: ++deployment.revisionSequence })),
      setDraftRevisionIfSequence: jest.fn().mockResolvedValue(true),
    };
    const revisionStore = {
      findById: jest.fn().mockImplementation(async () => currentDraft),
      countByDeployment: jest.fn().mockResolvedValue(1),
      insert: jest.fn().mockImplementation(async (payload) => {
        currentDraft = { ...payload, id: createdRevisionId };
        return currentDraft;
      }),
      deleteByIdAndStatus: jest.fn().mockResolvedValue(true),
    };
    const audit = { logSuccess: jest.fn() };
    const service = new GovernanceDraftPreparationService(scopeStore as never, bindingStore as never, deploymentStore as never, revisionStore as never, audit as never);

    await service.prepare(new Types.ObjectId().toString(), 'actor@example.com', programId, scopeId);
    expect(revisionStore.insert).toHaveBeenCalledTimes(1);
    expect(deploymentStore.setDraftRevisionIfSequence).toHaveBeenCalledWith(deploymentId, 2, createdRevisionId);
    expect(scopeStore.setMetadataReviewStatus).toHaveBeenCalledWith(scopeId, 'in_review');
    expect(audit.logSuccess).toHaveBeenCalledTimes(1);
  });

  it('skips creating a revision when the configuration fingerprint is unchanged', async () => {
    const programId = new Types.ObjectId().toString();
    const scopeId = new Types.ObjectId().toString();
    const agentId = new Types.ObjectId().toString();
    const scope = { id: scopeId, programId, name: 'Scope', type: 'custom', status: 'active', agentIds: [agentId], metadata: {}, audience: { mode: 'restricted', userIds: [], groupIds: [] }, knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] } };
    // Snapshot matching the fingerprint of the configuration above.
    const currentDraft: Record<string, any> = { id: new Types.ObjectId().toString(), status: 'draft', previousAudienceSnapshot: {}, agentId, allowedAgentIds: [agentId], workspaceIds: [], workspaceBindingSnapshot: {}, scopeSnapshot: { name: 'Scope', type: 'custom', status: 'active', classification: {} }, audienceSnapshot: { mode: 'restricted', userIds: [], groupIds: [] } };
    const crypto = require('crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ allowedAgentIds: [agentId], workspaceIds: [], workspaceBindingSnapshot: {}, scopeSnapshot: { name: 'Scope', type: 'custom', status: 'active', classification: {} }, audienceSnapshot: { mode: 'restricted', userIds: [], groupIds: [] } })).digest('hex');
    currentDraft.configurationFingerprint = fingerprint;
    const deployment = { id: new Types.ObjectId().toString(), status: 'draft', channels: {}, revisionSequence: 1, currentDraftRevisionId: currentDraft.id };
    const scopeStore = { findByProgramAndId: jest.fn().mockResolvedValue(scope), setMetadataReviewStatus: jest.fn() };
    const bindingStore = { listEnabled: jest.fn().mockResolvedValue([]) };
    const deploymentStore = { findByProgramAndScope: jest.fn().mockResolvedValue(deployment), maxRevisionSequence: jest.fn(), incrementRevisionSequenceGuarded: jest.fn(), setDraftRevisionIfSequence: jest.fn() };
    const revisionStore = { findById: jest.fn().mockResolvedValue(currentDraft), countByDeployment: jest.fn(), insert: jest.fn(), deleteByIdAndStatus: jest.fn() };
    const audit = { logSuccess: jest.fn() };
    const service = new GovernanceDraftPreparationService(scopeStore as never, bindingStore as never, deploymentStore as never, revisionStore as never, audit as never);

    await service.prepare(new Types.ObjectId().toString(), 'actor@example.com', programId, scopeId);
    expect(revisionStore.insert).not.toHaveBeenCalled();
    expect(audit.logSuccess).not.toHaveBeenCalled();
  });
});
