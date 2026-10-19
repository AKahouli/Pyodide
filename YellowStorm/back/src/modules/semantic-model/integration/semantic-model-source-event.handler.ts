import { Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { WorkspaceIntegrationEvents, type WorkspaceDocumentEventV1 } from '@modules/integration-events/contracts';
import type { IntegrationEventEnvelope } from '@modules/integration-events/interfaces/integration-event.interface';
import { IntegrationEventHandlerRegistryService } from '@modules/integration-events/services/integration-event-handler-registry.service';
import { SemanticAssetGrantService } from '../services/semantic-asset-grant.service';

@Injectable()
export class SemanticModelSourceEventHandler implements OnModuleInit {
  readonly handlerKey = 'semantic-model.source-events.v1';
  readonly eventTypes = [
    WorkspaceIntegrationEvents.DocumentRegisteredV1,
    WorkspaceIntegrationEvents.ArtifactReadyV1,
    WorkspaceIntegrationEvents.IndexingStartedV1,
    WorkspaceIntegrationEvents.IndexingReadyV1,
    WorkspaceIntegrationEvents.IndexingFailedV1,
    WorkspaceIntegrationEvents.DocumentDeletedV1,
  ];

  constructor(
    private readonly registry: IntegrationEventHandlerRegistryService,
    @Inject(semanticModelConfig.KEY) private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly assetGrants: SemanticAssetGrantService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: IntegrationEventEnvelope): Promise<void> {
    if (!this.config.runtimeEnabled || !this.config.runtimeWritesEnabled) return;
    if (!this.config.runtimeUrl || !this.config.runtimeServiceKey) {
      throw new ServiceUnavailableException('Semantic model runtime relay is not configured');
    }
    const payload = event.payload as unknown as WorkspaceDocumentEventV1;
    if (!payload.workspaceId || !payload.documentId) {
      throw new ServiceUnavailableException('Workspace source event is missing identity');
    }
    // Only the trusted durable backend event publisher signs profiling authority.
    // An unsigned runtime event's createdBy never authorizes asset access.
    const actor = (event.payload as Record<string, unknown>).createdBy;
    const assetAdmissions = typeof actor === 'string' && event.eventType !== WorkspaceIntegrationEvents.DocumentDeletedV1
      ? await this.assetGrants.admitSourceEvent(event.eventId, event.occurredAt.toISOString(), event.payload)
      : undefined;
    const res = await fetch(`${this.config.runtimeUrl.replace(/\/+$/, '')}/v1/semantic-model-datasource/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Semantic-Service-Key': this.config.runtimeServiceKey,
      },
      body: JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        payload: { ...event.payload, assetAdmissions },
      }),
      signal: AbortSignal.timeout(this.config.runtimeRequestTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Semantic model runtime relay returned HTTP ${res.status}`);
    }
  }
}
