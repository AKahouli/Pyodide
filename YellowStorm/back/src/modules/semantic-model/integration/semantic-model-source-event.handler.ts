import { Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
import semanticModelConfig from '@config/semantic-model.config';
import { WorkspaceIntegrationEvents, type WorkspaceDocumentEventV1 } from '@modules/integration-events/contracts';
import type { IntegrationEventEnvelope } from '@modules/integration-events/interfaces/integration-event.interface';
import { IntegrationEventHandlerRegistryService } from '@modules/integration-events/services/integration-event-handler-registry.service';

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
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: IntegrationEventEnvelope<Record<string, unknown>>): Promise<void> {
    if (!this.config.runtimeEnabled || !this.config.runtimeWritesEnabled) return;
    if (!this.config.runtimeUrl || !this.config.runtimeServiceKey) {
      throw new ServiceUnavailableException('Semantic model runtime relay is not configured');
    }
    const payload = event.payload as unknown as WorkspaceDocumentEventV1;
    if (!payload.workspaceId || !payload.documentId) {
      throw new ServiceUnavailableException('Workspace source event is missing identity');
    }
    await axios.post(
      `${this.config.runtimeUrl.replace(/\/+$/, '')}/v1/semantic-model-datasource/events`,
      {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Semantic-Service-Key': this.config.runtimeServiceKey,
        },
        timeout: this.config.runtimeRequestTimeoutMs,
      },
    );
  }
}
