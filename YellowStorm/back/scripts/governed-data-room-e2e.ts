import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import databaseConfig from '@config/database.config';
import { WorkspaceDoc, WorkspaceDocumentSchema } from '@modules/workspace/schemas/workspace-document.schema';
import { GovernanceSource, GovernanceSourceSchema } from '@modules/governance/schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionSchema } from '@modules/governance/schemas/governance-source-version.schema';
import { GovernanceSourceEvent, GovernanceSourceEventSchema } from '@modules/governance/schemas/governance-source-event.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingSchema } from '@modules/governance/schemas/governance-workspace-binding.schema';
import { GovernanceSourceEventService } from '@modules/governance/services/governance-source-event.service';
import { GovernanceSourceVersionService } from '@modules/governance/services/governance-source-version.service';
import { GovernanceSourceTransitionService } from '@modules/governance/services/governance-source-transition.service';
import { GovernanceWorkspaceReconciliationService } from '@modules/governance/services/governance-workspace-reconciliation.service';
import { WorkspaceGovernanceEventHandler } from '@modules/governance/integration/workspace-governance-event.handler';
import { WorkspaceIntegrationEvents } from '@modules/integration-events/contracts';

async function run(): Promise<void> {
  const runId = `codex-e2e-${Date.now()}`;
  const programId = new Types.ObjectId();
  const workspaceId = new Types.ObjectId();
  const actorId = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const connection = await mongoose.createConnection(databaseConfig().uri).asPromise();
  const documents = connection.model(WorkspaceDoc.name, WorkspaceDocumentSchema);
  const sources = connection.model(GovernanceSource.name, GovernanceSourceSchema);
  const versions = connection.model(GovernanceSourceVersion.name, GovernanceSourceVersionSchema);
  const events = connection.model(GovernanceSourceEvent.name, GovernanceSourceEventSchema);
  const bindings = connection.model(GovernanceWorkspaceBinding.name, GovernanceWorkspaceBindingSchema);

  try {
    const binding = await bindings.create({ programId, workspaceId, visibility: 'program_shared', scopeIds: [], ingestionMode: 'automatic', defaults: {}, createdBy: actorId });
    const document = await documents.create({ _id: documentId, originalName: `${runId}.pdf`, mimeType: 'application/pdf', size: 32, path: `/${runId}.pdf`, workspaceId, createdBy: actorId, status: 'completed', indexingStatus: 'pending', type: 'doc', contentHash: `${runId}-hash` });
    const eventService = new GovernanceSourceEventService(events as never);
    const versionService = new GovernanceSourceVersionService(sources as never, versions as never, eventService);
    const handler = new WorkspaceGovernanceEventHandler(
      { register: () => undefined } as never,
      { get: () => true } as never,
      { enabledForWorkspace: async () => [binding] } as never,
      versionService,
      eventService,
      sources as never,
      versions as never,
    );
    const payload = { workspaceId: workspaceId.toString(), documentId: document._id.toString(), documentType: 'doc' as const, originalName: document.originalName, mimeType: document.mimeType, contentHash: document.contentHash, documentStatus: document.status, indexingStatus: document.indexingStatus };
    await handler.handle({ eventId: `${runId}:registered`, eventType: WorkspaceIntegrationEvents.DocumentRegisteredV1, occurredAt: new Date(), payload } as never);
    await handler.handle({ eventId: `${runId}:ready`, eventType: WorkspaceIntegrationEvents.IndexingReadyV1, occurredAt: new Date(), payload: { ...payload, indexingStatus: 'ready' } } as never);
    const source = await sources.findOne({ programId, originKey: `workspace-document:${workspaceId}:${document._id}` }).exec();
    const version = await versions.findOne({ documentId: document._id }).exec();
    if (!source || !version || version.technicalStatus !== 'ready') throw new Error('Candidate source version was not created and made ready');
    const transitions = new GovernanceSourceTransitionService(sources as never, versions as never, { assertProgramWideAccess: async () => undefined } as never, eventService);
    await transitions.transition(actorId.toString(), programId.toString(), source._id.toString(), version._id.toString(), 'to_review');
    await transitions.transition(actorId.toString(), programId.toString(), source._id.toString(), version._id.toString(), 'approved');
    await transitions.transition(actorId.toString(), programId.toString(), source._id.toString(), version._id.toString(), 'published');
    await documents.deleteOne({ _id: document._id }).exec();
    await handler.handle({ eventId: `${runId}:deleted`, eventType: WorkspaceIntegrationEvents.DocumentDeletedV1, occurredAt: new Date(), payload: { ...payload, indexingStatus: 'ready' } } as never);
    const reconciliation = new GovernanceWorkspaceReconciliationService(bindings as never, documents as never, sources as never, versions as never, versionService, eventService);
    await reconciliation.reconcileBinding(binding._id.toString(), false);
    const deletedVersion = await versions.findById(version._id).exec();
    const history = await events.find({ sourceId: source._id }).exec();
    if (!deletedVersion || deletedVersion.lifecycleStatus !== 'published' || deletedVersion.extractedMetadata.artifactAvailable !== false || !history.some((event) => event.eventType === 'artifact.unavailable')) throw new Error('Deletion did not preserve published governance history');
    process.stdout.write(`PASS ${runId}: source lifecycle and deletion history verified\n`);
  } finally {
    await Promise.all([documents.deleteMany({ workspaceId }).exec(), versions.deleteMany({ workspaceId }).exec(), sources.deleteMany({ programId }).exec(), events.deleteMany({ programId }).exec(), bindings.deleteMany({ programId, workspaceId }).exec()]);
    await connection.close();
  }
}

void run().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'Governed data room E2E failed'}\n`); process.exitCode = 1; });
