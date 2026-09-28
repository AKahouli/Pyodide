import { Module } from '@nestjs/common';
import { IntegrationEventOutboxService } from './services/integration-event-outbox.service';
import { IntegrationEventDispatcherService } from './services/integration-event-dispatcher.service';
import { IntegrationEventHandlerRegistryService } from './services/integration-event-handler-registry.service';
import { LoggerModule } from '@modules/logger';

// P6 cutover: the outbox lives in ops.integration_events, reached through the global Drizzle connection.
@Module({ imports: [LoggerModule], providers: [IntegrationEventOutboxService, IntegrationEventDispatcherService, IntegrationEventHandlerRegistryService], exports: [IntegrationEventOutboxService, IntegrationEventHandlerRegistryService] })
export class IntegrationEventsModule {}
