import { Types } from 'mongoose';
import { WorkspaceGovernanceEventHandler } from './workspace-governance-event.handler';
import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';
import { GovernanceSourceFromWorkspaceFactory } from '../factories/governance-source-from-workspace.factory';

describe('WorkspaceGovernanceEventHandler', () => {
  const bindingId = new Types.ObjectId();
  const programId = new Types.ObjectId();
  const sourceId = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const source = { _id: sourceId };
  const binding = { _id: bindingId, programId, scopeIds: [], visibility: 'program_shared', ingestionMode: 'assisted', defaults: {}, createdBy: new Types.ObjectId() };
  const payload = { workspaceId: new Types.ObjectId().toString(), documentId: documentId.toString(), documentType: 'url' as const, originalName: 'Example', normalizedSourceUrl: 'https://example.test', sourceUrl: 'https://example.test' };

  it('updates the initial URL candidate when conversion supplies its content hash', async () => {
    const existingVersion = { canonicalUrl: payload.normalizedSourceUrl, contentHash: undefined as string | undefined, extractedMetadata: {}, save: jest.fn().mockResolvedValue(undefined) };
    const sourceModel = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(source) })), create: jest.fn() };
    const versionModel = { findOne: jest.fn((query: Record<string, unknown>) => {
      if ('originEventId' in query) return { exec: jest.fn().mockResolvedValue(null) };
      return { sort: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(existingVersion) })) };
    }) };
    const versions = { create: jest.fn(), updateTechnicalStatus: jest.fn() };
    const events = { append: jest.fn().mockResolvedValue(undefined) };
    const handler = new WorkspaceGovernanceEventHandler({ register: jest.fn() } as never, { get: jest.fn().mockReturnValue(true) } as never, { enabledForWorkspace: jest.fn().mockResolvedValue([binding]) } as never, versions as never, events as never, sourceModel as never, versionModel as never, new GovernanceSourceFromWorkspaceFactory(), { enqueue: jest.fn() } as never, { getSettings: jest.fn().mockResolvedValue({ connectorId: 'connector-1' }) } as never);

    await handler.handle({ eventId: 'converted', eventType: WorkspaceIntegrationEvents.DocumentRegisteredV1, occurredAt: new Date(), payload: { ...payload, contentHash: 'hash-1' } } as never);

    expect(versions.create).not.toHaveBeenCalled();
    expect(existingVersion.contentHash).toBe('hash-1');
    expect(existingVersion.extractedMetadata).toEqual({ artifactAvailable: true });
    expect(existingVersion.save).toHaveBeenCalledTimes(1);
  });

  it('enqueues intelligence only after the ready state was persisted', async () => {
    const readyEvent = { eventId: 'ready-1', eventType: WorkspaceIntegrationEvents.IndexingReadyV1, occurredAt: new Date() };
    const readyVersion = { _id: new Types.ObjectId(), sourceId, programId, documentId, technicalStatus: 'ready' as const, contentHash: 'hash-1', indexingAttemptId: 'attempt-1' };
    const sourceModel = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ ...source, currentCandidateVersionId: readyVersion._id }) })) };
    const versionModel = { findOne: jest.fn((query: Record<string, unknown>) => 'originEventId' in query ? { exec: jest.fn().mockResolvedValue(null) } : { sort: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(readyVersion) })) }) };
    const versions = { updateTechnicalStatus: jest.fn().mockResolvedValue(readyVersion) };
    const intelligence = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const handler = new WorkspaceGovernanceEventHandler({ register: jest.fn() } as never, { get: jest.fn().mockReturnValue(true) } as never, { enabledForWorkspace: jest.fn().mockResolvedValue([binding]) } as never, versions as never, { append: jest.fn() } as never, sourceModel as never, versionModel as never, new GovernanceSourceFromWorkspaceFactory(), intelligence as never, { getSettings: jest.fn().mockResolvedValue({ connectorId: 'connector-1' }) } as never);

    await handler.handle({ ...readyEvent, payload: { ...payload, indexingAttemptId: 'attempt-1' } } as never);

    expect(versions.updateTechnicalStatus).toHaveBeenCalledWith(programId.toString(), sourceId.toString(), readyVersion._id.toString(), 'ready', readyEvent.eventId, readyEvent.occurredAt, 'attempt-1');
    expect(intelligence.enqueue).toHaveBeenCalledWith(expect.objectContaining({ sourceVersionId: readyVersion._id.toString(), jobType: 'technical_metadata', inputHash: expect.any(String) }));
  });

  it('does not enqueue for an out-of-order terminal event from another indexing attempt', async () => {
    const persistedVersion = { _id: new Types.ObjectId(), sourceId, programId, documentId, technicalStatus: 'ready' as const, contentHash: 'hash-1', indexingAttemptId: 'accepted-attempt' };
    const sourceModel = { findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(source) })) };
    const versionModel = { findOne: jest.fn((query: Record<string, unknown>) => 'originEventId' in query ? { exec: jest.fn().mockResolvedValue(null) } : { sort: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(persistedVersion) })) }) };
    const versions = { updateTechnicalStatus: jest.fn().mockResolvedValue(persistedVersion) };
    const intelligence = { enqueue: jest.fn() };
    const handler = new WorkspaceGovernanceEventHandler({ register: jest.fn() } as never, { get: jest.fn().mockReturnValue(true) } as never, { enabledForWorkspace: jest.fn().mockResolvedValue([binding]) } as never, versions as never, { append: jest.fn() } as never, sourceModel as never, versionModel as never, new GovernanceSourceFromWorkspaceFactory(), intelligence as never, { getSettings: jest.fn().mockResolvedValue({ connectorId: 'connector-1' }) } as never);

    await handler.handle({ eventId: 'stale-ready', eventType: WorkspaceIntegrationEvents.IndexingReadyV1, occurredAt: new Date(), payload: { ...payload, indexingAttemptId: 'stale-attempt' } } as never);

    expect(intelligence.enqueue).not.toHaveBeenCalled();
  });
});
