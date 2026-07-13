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

@Injectable()
export class WorkspaceGovernanceEventHandler implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceGovernanceEventHandler.name);
  readonly eventTypes = Object.values(WorkspaceIntegrationEvents);
  constructor(private readonly registry: IntegrationEventHandlerRegistryService, private readonly config: ConfigService, private readonly bindings: GovernanceWorkspaceBindingService, private readonly versions: GovernanceSourceVersionService, private readonly events: GovernanceSourceEventService, @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>) {}
  onModuleInit(): void { this.registry.register(this); }
  async handle(event: IntegrationEventEnvelope<Record<string, unknown>>): Promise<void> {
    if (!this.config.get<boolean>('dataRoom.autoSourceCreationEnabled')) return;
    const payload = event.payload as unknown as WorkspaceDocumentEventV1;
    if (!payload.workspaceId || !payload.documentId) throw new BadRequestException('Invalid workspace integration event payload');
    const bindings = await this.bindings.enabledForWorkspace(payload.workspaceId);
    const failedBindingIds: string[] = [];
    for (const binding of bindings) {
      if (binding.ingestionMode === 'manual') continue;
      try {
      const programId = binding.programId.toString();
      const originKey = payload.documentType === 'url' && payload.normalizedSourceUrl ? `canonical-url:${payload.normalizedSourceUrl}` : `workspace-document:${payload.workspaceId}:${payload.documentId}`;
      let source = await this.sourceModel.findOne({ programId: binding.programId, originKey }).exec();
      if (!source) source = await this.sourceModel.create({ programId: binding.programId, scopeIds: binding.scopeIds, visibility: binding.visibility, title: payload.originalName, sourceType: payload.documentType === 'url' ? 'web_page' : 'pdf', url: payload.sourceUrl, workspaceId: new Types.ObjectId(payload.workspaceId), documentId: new Types.ObjectId(payload.documentId), originKey, ownerUserId: binding.defaults.ownerUserId ? new Types.ObjectId(binding.defaults.ownerUserId) : undefined, ownerScopeId: binding.defaults.ownerScopeId ? new Types.ObjectId(binding.defaults.ownerScopeId) : binding.scopeIds[0], createdBy: binding.createdBy });
      const versionEventId = `${binding._id.toString()}:${event.eventId}`;
      const existing = await this.versionModel.findOne({ originEventId: versionEventId }).exec();
      if (event.eventType === WorkspaceIntegrationEvents.DocumentRegisteredV1 || event.eventType === WorkspaceIntegrationEvents.WebPageRegisteredV1) {
        const capturedVersion = await this.versionModel.findOne({ sourceId: source._id, documentId: new Types.ObjectId(payload.documentId) }).sort({ versionNumber: -1 }).exec();
        if (!existing && !capturedVersion) await this.versions.create(binding.createdBy.toString(), programId, source._id.toString(), { workspaceId: payload.workspaceId, documentId: payload.documentId, canonicalUrl: payload.normalizedSourceUrl, contentHash: payload.contentHash, extractedMetadata: binding.ingestionMode === 'assisted' ? { ingestionRequiresConfirmation: true } : {} }, versionEventId);
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
        await this.events.append({ programId, sourceId: source._id.toString(), versionId: version._id.toString(), eventType: 'artifact.ready', metadata: { eventId: event.eventId } });
        continue;
      }
      if (event.eventType === WorkspaceIntegrationEvents.DocumentDeletedV1) { version.extractedMetadata = { ...version.extractedMetadata, artifactAvailable: false }; await version.save(); await this.events.append({ programId, sourceId: source._id.toString(), versionId: version._id.toString(), eventType: 'artifact.unavailable', metadata: { eventId: event.eventId } }); continue; }
      const status = event.eventType === WorkspaceIntegrationEvents.IndexingReadyV1 ? 'ready' : event.eventType === WorkspaceIntegrationEvents.IndexingFailedV1 ? 'failed' : event.eventType === WorkspaceIntegrationEvents.IndexingStartedV1 ? 'processing' : 'pending';
      await this.versions.updateTechnicalStatus(programId, source._id.toString(), version._id.toString(), status, event.eventId, event.occurredAt);
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
