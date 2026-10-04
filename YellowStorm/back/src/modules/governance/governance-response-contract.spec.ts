import { Types } from 'mongoose';
import { GovernanceProgramService, type GovernanceProgramResponse } from './services/governance-program.service';
import { GovernanceScopeService, type GovernanceScopeResponse } from './services/governance-scope.service';
import { GovernanceDocumentService, type GovernanceDocumentResponse } from './services/governance-document.service';
import { GovernanceMembershipService, type GovernanceMembershipResponse } from './services/governance-membership.service';
import { GovernanceDeploymentService, type GovernanceDeploymentResponse, type GovernanceRevisionResponse } from './services/governance-deployment.service';
import { GovernanceDryRunService, type GovernanceDryRunResponse } from './services/governance-dry-run.service';
import { GovernanceMetricService, type GovernanceMetricResponse } from './services/governance-metric.service';
import type {
  GovernanceBindingRecord,
  GovernanceProgramRecord,
  GovernancePublicationAttemptRecord,
  GovernanceReconciliationRunRecord,
  GovernanceScopeRecord,
} from './persistence';

/**
 * Contract fixtures for the governance REST surface (Step E.2). These assert
 * the exact response shapes (field names, nullability, id/date serialization)
 * produced by the service mappers — independent of the persistence engine, so
 * the PostgreSQL cutover keeps the wire format byte-for-byte.
 */

const NOW = new Date('2026-09-18T10:00:00.000Z');
const ISO = '2026-09-18T10:00:00.000Z';
const id = () => new Types.ObjectId().toString();

function programRecord(): GovernanceProgramRecord {
  return { id: id(), name: 'Programme data', description: 'desc', domain: 'finance', defaultLanguage: 'fr', status: 'published', ownerUserId: id(), metadata: { key: 'value' }, createdAt: NOW, updatedAt: NOW };
}

function scopeRecord(): GovernanceScopeRecord {
  return { id: id(), programId: id(), parentScopeId: id(), name: 'Courbevoie', type: 'municipality', status: 'active', agentIds: [id()], audience: { mode: 'restricted', userIds: [id()], groupIds: [id()] }, knowledge: { sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: ['docs.example.com'], webBlockedDomains: [] }, metadata: { description: 'Scope' }, createdAt: NOW, updatedAt: NOW };
}

function documentRecord(): Parameters<GovernanceDocumentService['toResponse']>[0] {
  return { id: id(), programId: id(), documentId: id(), workspaceId: id(), status: 'to_review', validity: { businessStatus: 'needs_review' }, tags: ['policy'], metadata: {}, governanceRevision: 2, temporalDecisionRevision: 0, createdAt: NOW, updatedAt: NOW };
}

function membershipRecord(): Record<string, unknown> {
  return { id: id(), programId: id(), scopeId: id(), userId: id(), invitedBy: id(), role: 'scope_approver', status: 'active', permissions: ['governance.read'], createdAt: NOW, updatedAt: NOW };
}

function bindingRecord(): GovernanceBindingRecord {
  return { id: id(), programId: id(), workspaceId: id(), visibility: 'multi_scope', scopeIds: [id(), id()], enabled: true, ingestionMode: 'assisted', defaults: { reviewFrequencyDays: 90 }, createdBy: id(), createdAt: NOW, updatedAt: NOW };
}

function runRecord(): GovernanceReconciliationRunRecord {
  return { id: id(), bindingId: id(), status: 'completed', dryRun: false, stats: { scannedDocuments: 4 }, errors: [], startedAt: NOW, completedAt: NOW, leaseToken: 'secret-lease', leaseExpiresAt: NOW, createdAt: NOW, updatedAt: NOW };
}

function publicationRecord(): GovernancePublicationAttemptRecord {
  return { id: id(), programId: id(), scopeId: id(), deploymentId: id(), revisionId: id(), triggeredByUserId: id(), triggeredByEmail: 'actor@example.com', requestedChannels: ['widget'], allowPartial: false, comment: 'go', status: 'success', readinessSnapshot: {}, createdAt: NOW, updatedAt: NOW };
}

const iso = (value: Date) => value.toISOString();

describe('Governance REST response contract fixtures', () => {
  it('serializes a program: id (no _id/__v), owner-less payload, ISO dates', async () => {
    const record = programRecord();
    const store = { findByOwnerAndId: jest.fn().mockResolvedValue(record) };
    const service = new GovernanceProgramService(store as never, {} as never, {} as never, {} as never, { findActiveForUser: jest.fn().mockResolvedValue([]), findActiveByUser: jest.fn().mockResolvedValue([]) } as never);
    const response: GovernanceProgramResponse = await service.findById(record.ownerUserId, record.id);
    expect(Object.keys(response).sort()).toEqual(['createdAt', 'defaultLanguage', 'description', 'domain', 'id', 'metadata', 'name', 'status', 'updatedAt']);
    expect(response).toEqual({ id: record.id, name: record.name, description: 'desc', domain: 'finance', defaultLanguage: 'fr', status: 'published', metadata: { key: 'value' }, createdAt: ISO, updatedAt: ISO });
  });

  it('serializes a scope with nested knowledge and string agent ids', async () => {
    const record = scopeRecord();
    const service = new GovernanceScopeService({ findByProgramAndId: jest.fn().mockResolvedValue(record) } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { assertOwnedProgram: jest.fn(), assertProgramOwner: jest.fn() } as never, { findGroupIdsForMember: jest.fn().mockResolvedValue([]) } as never, {} as never, {} as never, {} as never);
    const response: GovernanceScopeResponse = await service.findById(id(), record.programId, record.id);
    expect(Object.keys(response).sort()).toEqual(['agentIds', 'createdAt', 'id', 'knowledge', 'metadata', 'name', 'parentScopeId', 'programId', 'status', 'type', 'updatedAt']);
    expect(response.id).toBe(record.id);
    expect(response.parentScopeId).toBe(record.parentScopeId);
    expect(response.agentIds).toEqual(record.agentIds);
    expect(response.knowledge).toEqual(record.knowledge);
    expect(response.createdAt).toBe(ISO);
  });

  it('serializes a document detail with the nested document + governance blocks', async () => {
    const record = documentRecord();
    const artifact = { id: record.documentId, workspaceId: record.workspaceId, isFolder: false, originalName: 'brief.pdf', mimeType: 'application/pdf', type: 'file', sourceUrl: undefined, contentHash: 'abc', status: 'completed', indexingStatus: 'ready', updatedAt: NOW };
    const service = new GovernanceDocumentService({ findByProgramAndDocumentId: jest.fn().mockResolvedValue(record) } as never, { findOne: jest.fn().mockResolvedValue(artifact) } as never, { listEnabled: jest.fn().mockResolvedValue([{ workspaceId: record.workspaceId }]) } as never, { assertOwnedProgram: jest.fn() } as never, { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) } as never, {} as never, {} as never, { run: (fn: () => Promise<unknown>) => fn() } as never);
    const response: GovernanceDocumentResponse = await service.findByDocumentId(id(), record.programId, record.documentId);
    expect(Object.keys(response).sort()).toEqual(['document', 'documentId', 'governance', 'id', 'programId', 'workspaceId']);
    expect(response.document).toEqual({ originalName: 'brief.pdf', mimeType: 'application/pdf', type: 'file', sourceUrl: undefined, contentHash: 'abc', status: 'completed', indexingStatus: 'ready', updatedAt: ISO });
    expect(Object.keys(response.governance).sort()).toEqual(['archiveReason', 'archivedAt', 'createdAt', 'metadata', 'ownerScopeId', 'ownerUserId', 'revision', 'status', 'tags', 'updatedAt', 'validity']);
    expect(response.governance.revision).toBe(2);
    expect(response.governance.validity).toEqual({ businessStatus: 'needs_review' });
  });

  it('serializes a membership with optional user/group summaries', async () => {
    const record = membershipRecord();
    const summary = { id: record.userId as string, email: 'user@example.com', firstName: 'U', lastName: '' };
    const service = new GovernanceMembershipService(
      { listByProgram: jest.fn().mockResolvedValue([record]), findActiveForUser: jest.fn().mockResolvedValue([]), findActiveByUser: jest.fn().mockResolvedValue([]) } as never,
      { byIds: jest.fn().mockResolvedValue(new Map([[summary.id, summary]])) } as never,
      { summariesByIds: jest.fn().mockResolvedValue(new Map()) } as never,
      { assertOwnedProgram: jest.fn(), assertProgramOwner: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      { findGroupIdsForMember: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
    );
    const responses: GovernanceMembershipResponse[] = await service.list(id(), record.programId as string);
    const response = responses[0];
    expect(Object.keys(response).sort()).toEqual(['createdAt', 'group', 'groupId', 'id', 'invitedBy', 'permissions', 'programId', 'role', 'scopeId', 'status', 'updatedAt', 'user', 'userId']);
    expect(response.user).toEqual({ id: summary.id, email: 'user@example.com', firstName: 'U', lastName: undefined });
    expect(response.group).toBeUndefined();
    expect(response.createdAt).toBe(ISO);
  });

  it('serializes a deployment and revision', () => {
    const service = new GovernanceDeploymentService({} as never, {} as never, {} as never, {} as never, {} as never, { assertOwnedProgram: jest.fn() } as never, {} as never, {} as never, {} as never, {} as never);
    const deploymentRecord = { id: id(), programId: id(), scopeId: id(), name: 'Public', status: 'published', currentDraftRevisionId: id(), currentPublishedRevisionId: id(), channels: { widget: { enabled: true } }, createdAt: NOW, updatedAt: NOW };
    const deploymentResponse: GovernanceDeploymentResponse = service.toDeploymentResponse(deploymentRecord as never);
    expect(Object.keys(deploymentResponse).sort()).toEqual(['channels', 'createdAt', 'currentDraftRevisionId', 'currentPublishedRevisionId', 'id', 'name', 'programId', 'scopeId', 'status', 'updatedAt']);

    const revisionRecord = { id: id(), deploymentId: deploymentRecord.id, revisionNumber: 1, status: 'published', agentId: id(), allowedAgentIds: [], workspaceIds: [id()], agentSnapshot: {}, workspaceBindingSnapshot: {}, channelSnapshot: {}, scopeSnapshot: {}, audienceSnapshot: {}, previousAudienceSnapshot: {}, createdBy: id(), publishedAt: NOW, createdAt: NOW, updatedAt: NOW };
    const revisionResponse: GovernanceRevisionResponse = service.toRevisionResponse(revisionRecord as never);
    expect(Object.keys(revisionResponse).sort()).toEqual(['agentId', 'allowedAgentIds', 'audienceSnapshot', 'configurationFingerprint', 'createdAt', 'createdBy', 'deploymentId', 'id', 'previousAudienceSnapshot', 'publishedAt', 'publishedBy', 'revisionNumber', 'scopeSnapshot', 'status', 'updatedAt', 'workspaceBindingSnapshot', 'workspaceIds']);
    // Roster fallback: allowedAgentIds falls back to the primary agent when empty.
    expect(revisionResponse.allowedAgentIds).toEqual([revisionRecord.agentId]);
  });

  it('serializes a dry-run with execution mode and checks', async () => {
    const record = { id: id(), programId: id(), scopeId: id(), deploymentId: id(), revisionId: id(), conversationId: id(), testerId: id(), status: 'passed', executionMode: 'conversation', testCases: [{ input: 'hello' }], checks: { runtime: 'completed' }, createdAt: NOW, updatedAt: NOW };
    const dryRunStore = { findById: jest.fn().mockResolvedValue(record) };
    const service = new GovernanceDryRunService(dryRunStore as never, { findById: jest.fn().mockResolvedValue({ id: record.deploymentId, programId: record.programId, scopeId: record.scopeId }) } as never, {} as never, { assertOwnedProgram: jest.fn() } as never, { assertScopeAccess: jest.fn() } as never, {} as never, {} as never, {} as never, {} as never);
    const response: GovernanceDryRunResponse = await service.findById(id(), record.id);
    expect(Object.keys(response).sort()).toEqual(['checks', 'conversationId', 'createdAt', 'deploymentId', 'executionMode', 'id', 'programId', 'revisionId', 'scopeId', 'status', 'testCases', 'testerId', 'updatedAt']);
    expect(response.testCases).toEqual([{ input: 'hello' }]);
  });

  it('serializes a metric with optional channel and period ISO dates', async () => {
    const record = { id: id(), programId: id(), scopeId: id(), deploymentId: undefined, agentId: undefined, channel: 'widget', type: 'usage', value: 3, dimensions: { channel: 'widget' }, periodStart: NOW, periodEnd: NOW };
    const service = new GovernanceMetricService({ listForProgramScopes: jest.fn().mockResolvedValue([record]) } as never, { assertOwnedProgram: jest.fn() } as never, { getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) } as never);
    const responses: GovernanceMetricResponse[] = await service.list(id(), record.programId);
    expect(Object.keys(responses[0]).sort()).toEqual(['agentId', 'channel', 'deploymentId', 'dimensions', 'id', 'periodEnd', 'periodStart', 'programId', 'scopeId', 'type', 'value']);
    expect(responses[0].periodStart).toBe(ISO);
    expect(responses[0].value).toBe(3);
  });

  it('strips reconciliation lease internals like the former toJSON transform', () => {
    const record = runRecord();
    const { leaseToken, leaseExpiresAt, ...response } = record as unknown as GovernanceReconciliationRunRecord & Record<string, unknown>;
    leaseToken;
    leaseExpiresAt;
    expect(Object.keys(response).sort()).toEqual(['bindingId', 'completedAt', 'createdAt', 'dryRun', 'errors', 'id', 'startedAt', 'stats', 'status', 'updatedAt']);
    expect((response as Record<string, unknown>).leaseToken).toBeUndefined();
  });

  it('keeps the binding record as the REST payload (formerly the Mongo toJSON shape)', () => {
    const record = bindingRecord();
    const payload: GovernanceBindingRecord = record;
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'createdBy', 'defaults', 'enabled', 'id', 'ingestionMode', 'programId', 'scopeIds', 'updatedAt', 'visibility', 'workspaceId']);
    expect(payload.scopeIds).toHaveLength(2);
  });

  it('serializes a publication attempt audit record', () => {
    const record = publicationRecord();
    expect(Object.keys(record).sort()).toEqual(['allowPartial', 'comment', 'createdAt', 'deploymentId', 'id', 'programId', 'readinessSnapshot', 'requestedChannels', 'revisionId', 'scopeId', 'status', 'triggeredByEmail', 'triggeredByUserId', 'updatedAt']);
    expect(iso(record.createdAt)).toBe(ISO);
  });
});
