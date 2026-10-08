import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { IntegrationEventHandlerRegistryService } from '@modules/integration-events/services/integration-event-handler-registry.service';
import { WorkspaceIntegrationEvents, type WorkspaceDocumentEventV1 } from '@modules/integration-events/contracts';
import type { IntegrationEventEnvelope } from '@modules/integration-events/interfaces/integration-event.interface';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { WorkspaceEvidenceSearchSettingsService } from '@modules/system/workspace-evidence-search-settings.service';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { GovernanceWorkspaceBindingService } from '../services/governance-workspace-binding.service';
import { GovernanceDocumentService } from '../services/governance-document.service';

@Injectable()
export class WorkspaceGovernanceEventHandler implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceGovernanceEventHandler.name);
  readonly handlerKey = 'governance.workspace-events.v1';
  readonly eventTypes = Object.values(WorkspaceIntegrationEvents);

  constructor(
    private readonly registry: IntegrationEventHandlerRegistryService,
    private readonly config: ConfigService,
    private readonly featureVisibility: FeatureVisibilityService,
    private readonly bindings: GovernanceWorkspaceBindingService,
    private readonly documents: GovernanceDocumentService,
    private readonly intelligence: KnowledgeExtractionOrchestratorService,
    private readonly evidenceSettings: WorkspaceEvidenceSearchSettingsService,
  ) {}

  onModuleInit(): void { this.registry.register(this); }

  async handle(event: IntegrationEventEnvelope): Promise<void> {
    if (!this.config.get<boolean>('dataRoom.governanceEventConsumerEnabled')) return;
    const payload = event.payload as unknown as WorkspaceDocumentEventV1;
    if (!payload.workspaceId || !payload.documentId) throw new BadRequestException('Invalid workspace integration event payload');
    const bindings = await this.bindings.enabledForWorkspace(payload.workspaceId);
    const failures: string[] = [];
    for (const binding of bindings) {
      try {
        const programId = binding.programId.toString();
        if (event.eventType === WorkspaceIntegrationEvents.DocumentDeletedV1) {
          await this.documents.archiveFromWorkspaceDeletion(programId, payload.documentId, binding.createdBy, { id: event.eventId, occurredAt: event.occurredAt });
          continue;
        }
        if (binding.ingestionMode === 'manual') continue;
        const governed = await this.documents.upsertFromWorkspace(programId, payload.documentId, binding.createdBy, { id: event.eventId, occurredAt: event.occurredAt });
        if (event.eventType !== WorkspaceIntegrationEvents.IndexingReadyV1 || !this.featureVisibility.isEnabled('dataRoomValidityIntelligence')) continue;
        const { connectorId } = await this.evidenceSettings.getSettings();
        if (!connectorId) continue;
        const inputHash = createHash('sha256').update(JSON.stringify({ programId, documentId: payload.documentId, contentHash: payload.contentHash ?? null, indexingAttemptId: payload.indexingAttemptId ?? null, connectorId })).digest('hex');
        await this.intelligence.enqueue({ programId, documentId: payload.documentId, connectorId, requestedByUserId: binding.createdBy, jobType: 'technical_metadata', inputHash, engineVersion: 'technical-metadata-v1' });
        governed;
      } catch (error) {
        this.logger.error('Failed to process workspace event for governance binding', { bindingId: binding.id, eventId: event.eventId, error: error instanceof Error ? error.message : 'Unknown error' });
        failures.push(binding.id);
      }
    }
    if (failures.length > 0) throw new BadRequestException(`Workspace event processing failed for binding(s): ${failures.join(', ')}`);
  }
}
