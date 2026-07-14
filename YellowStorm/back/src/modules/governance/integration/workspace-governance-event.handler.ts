import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { IntegrationEventHandlerRegistryService } from '@modules/integration-events/services/integration-event-handler-registry.service';
import { WorkspaceIntegrationEvents, type WorkspaceDocumentEventV1 } from '@modules/integration-events/contracts';
import type { IntegrationEventEnvelope } from '@modules/integration-events/interfaces/integration-event.interface';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument } from '../schemas/governance-source-version.schema';
import { GovernanceWorkspaceBindingService } from '../services/governance-workspace-binding.service';
import { GovernanceSourceVersionService } from '../services/governance-source-version.service';
import { GovernanceSourceEventService } from '../services/governance-source-event.service';
import { GovernanceSourceFromWorkspaceFactory } from '../factories/governance-source-from-workspace.factory';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { createHash } from 'crypto';
import { WorkspaceEvidenceSearchSettingsService } from '@modules/system/workspace-evidence-search-settings.service';

@Injectable()
export class WorkspaceGovernanceEventHandler implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceGovernanceEventHandler.name);
  readonly handlerKey = 'governance.workspace-events.v1';
  readonly eventTypes = Object.values(WorkspaceIntegrationEvents);
  constructor(private readonly registry: IntegrationEventHandlerRegistryService, private readonly config: ConfigService, private readonly bindings: GovernanceWorkspaceBindingService, private readonly versions: GovernanceSourceVersionService, private readonly events: GovernanceSourceEventService, @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, private readonly sourceFactory: GovernanceSourceFromWorkspaceFactory, private readonly intelligence: KnowledgeExtractionOrchestratorService, private readonly evidenceSettings: WorkspaceEvidenceSearchSettingsService) {}
  onModuleInit(): void { this.registry.register(this); }
  async handle(event: IntegrationEventEnvelope<Record<string, unknown>>): Promise<void> {
    if (!this.config.get<boolean>('dataRoom.governanceEventConsumerEnabled')) return;
    const payload = event.payload as unknown as WorkspaceDocumentEventV1;
    if (!payload.workspaceId || !payload.documentId) throw new BadRequestException('Invalid workspace integration event payload');
    const bindings = await this.bindings.enabledForWorkspace(payload.workspaceId);
    const failedBindingIds: string[] = [];
    for (const binding of bindings) {
      if (binding.ingestionMode === 'manual') continue;
      try {
      const programId = binding.programId.toString();
      const sourceCommand = this.sourceFactory.build(binding, payload);
      let source = await this.sourceModel.findOne({ programId: binding.programId, originKey: sourceCommand.originKey }).exec();
      if (source?.isArchived) continue;
      if (!source) {
        if (!this.config.get<boolean>('dataRoom.autoSourceCreationEnabled')) continue;
        source = await this.sourceModel.create(sourceCommand.source);
      }
      const versionEventId = `${binding._id.toString()}:${event.eventId}`;
      const existing = await this.versionModel.findOne({ originEventId: versionEventId }).exec();
      if (event.eventType === WorkspaceIntegrationEvents.DocumentRegisteredV1 || event.eventType === WorkspaceIntegrationEvents.WebPageRegisteredV1) {
        const capturedVersion = await this.versionModel.findOne({ sourceId: source._id, documentId: new Types.ObjectId(payload.documentId) }).sort({ versionNumber: -1 }).exec();
        if (!existing && !capturedVersion) await this.versions.create(binding.createdBy.toString(), programId, source._id.toString(), sourceCommand.version, versionEventId);
        else if (capturedVersion && !existing) {
          capturedVersion.canonicalUrl = payload.normalizedSourceUrl ?? capturedVersion.canonicalUrl;
          capturedVersion.contentHash = payload.contentHash ?? capturedVersion.contentHash;
          capturedVersion.extractedMetadata = { ...capturedVersion.extractedMetadata, artifactAvailable: true };
          await capturedVersion.save();
        }
        continue;
      }
      const version = await this.versionModel.findOne({ sourceId: source._id, documentId: new Types.ObjectId(payload.documentId) }).sort({ versionNumber: -1 }).exec();
      if (!version) continue;
      if (event.eventType === WorkspaceIntegrationEvents.ArtifactReadyV1) {
        version.canonicalUrl = payload.normalizedSourceUrl ?? version.canonicalUrl;
        version.contentHash = payload.contentHash ?? version.contentHash;
        version.extractedMetadata = { ...version.extractedMetadata, artifactAvailable: true };
        await version.save();
        await this.events.append({ programId, sourceId: source._id.toString(), versionId: version._id.toString(), eventType: 'artifact.ready', actorType: 'integration', occurredAt: event.occurredAt, correlationId: event.correlationId, causationId: event.causationId, deduplicationKey: `${binding._id}:${event.eventId}:artifact.ready`, metadata: { eventId: event.eventId } });
        continue;
      }
      if (event.eventType === WorkspaceIntegrationEvents.DocumentDeletedV1) { version.extractedMetadata = { ...version.extractedMetadata, artifactAvailable: false }; await version.save(); await this.events.append({ programId, sourceId: source._id.toString(), versionId: version._id.toString(), eventType: 'artifact.unavailable', actorType: 'integration', occurredAt: event.occurredAt, correlationId: event.correlationId, causationId: event.causationId, deduplicationKey: `${binding._id}:${event.eventId}:artifact.unavailable`, metadata: { eventId: event.eventId } }); continue; }
      const status = event.eventType === WorkspaceIntegrationEvents.IndexingReadyV1 ? 'ready' : event.eventType === WorkspaceIntegrationEvents.IndexingFailedV1 ? 'failed' : event.eventType === WorkspaceIntegrationEvents.IndexingStartedV1 ? 'processing' : 'pending';
      const acceptedAttempt = !payload.indexingAttemptId || version.indexingAttemptId === payload.indexingAttemptId;
      const updatedVersion = await this.versions.updateTechnicalStatus(programId, source._id.toString(), version._id.toString(), status, event.eventId, event.occurredAt, payload.indexingAttemptId);
      const isCurrentCandidate = source.currentCandidateVersionId?.toString() === updatedVersion._id.toString();
      if (status === 'ready' && acceptedAttempt && isCurrentCandidate && !['rejected', 'superseded'].includes(updatedVersion.lifecycleStatus) && updatedVersion.technicalStatus === 'ready' && this.config.get<boolean>('dataRoom.validityIntelligenceEnabled')) {
        const { connectorId } = await this.evidenceSettings.getSettings();
        if (connectorId) await this.intelligence.enqueue({ programId, sourceId: source._id.toString(), sourceVersionId: updatedVersion._id.toString(), connectorId, jobType: 'technical_metadata', inputHash: createHash('sha256').update(JSON.stringify({ sourceVersionId: updatedVersion._id.toString(), documentId: updatedVersion.documentId?.toString(), contentHash: updatedVersion.contentHash, indexingAttemptId: updatedVersion.indexingAttemptId ?? null, connectorId })).digest('hex'), engineVersion: 'technical-metadata-v1' });
      }
      } catch (error) {
        this.logger.error('Failed to process workspace event for governance binding', {
          bindingId: binding._id.toString(),
          eventId: event.eventId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failedBindingIds.push(binding._id.toString());
      }
    }
    if (failedBindingIds.length > 0) throw new BadRequestException(`Workspace event processing failed for binding(s): ${failedBindingIds.join(', ')}`);
  }
}
