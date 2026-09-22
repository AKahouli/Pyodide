import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  WorkspaceIntegrationEvents,
  type WorkspaceAccessChangedEventV1,
} from '@modules/integration-events/contracts';
import type { IntegrationEventEnvelope } from '@modules/integration-events/interfaces/integration-event.interface';
import { IntegrationEventHandlerRegistryService } from '@modules/integration-events/services/integration-event-handler-registry.service';
import { SemanticDataGrantRevocationService } from '../services/semantic-data-grant-revocation.service';

@Injectable()
export class SemanticAccessEventHandler implements OnModuleInit {
  readonly handlerKey = 'semantic-model.workspace-access.v1';
  readonly eventTypes = [WorkspaceIntegrationEvents.AccessChangedV1];

  constructor(
    private readonly registry: IntegrationEventHandlerRegistryService,
    private readonly grants: SemanticDataGrantRevocationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: IntegrationEventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as unknown as WorkspaceAccessChangedEventV1;
    if (!payload.workspaceId) return;
    await this.grants.revokeWorkspaceAccess(payload.workspaceId, payload.userId);
  }
}
