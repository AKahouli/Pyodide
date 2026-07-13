import { Types } from 'mongoose';
import { WorkspaceGovernanceEventHandler } from './workspace-governance-event.handler';
import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';

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
    const handler = new WorkspaceGovernanceEventHandler({ register: jest.fn() } as never, { get: jest.fn().mockReturnValue(true) } as never, { enabledForWorkspace: jest.fn().mockResolvedValue([binding]) } as never, versions as never, events as never, sourceModel as never, versionModel as never);

    await handler.handle({ eventId: 'converted', eventType: WorkspaceIntegrationEvents.DocumentRegisteredV1, occurredAt: new Date(), payload: { ...payload, contentHash: 'hash-1' } } as never);

    expect(versions.create).not.toHaveBeenCalled();
    expect(existingVersion.contentHash).toBe('hash-1');
    expect(existingVersion.extractedMetadata).toEqual({ artifactAvailable: true });
    expect(existingVersion.save).toHaveBeenCalledTimes(1);
  });
});
