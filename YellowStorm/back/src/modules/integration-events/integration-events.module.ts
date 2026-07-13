import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IntegrationEvent, IntegrationEventSchema } from './schemas/integration-event.schema';
import { IntegrationEventOutboxService } from './services/integration-event-outbox.service';
import { IntegrationEventDispatcherService } from './services/integration-event-dispatcher.service';
import { IntegrationEventHandlerRegistryService } from './services/integration-event-handler-registry.service';
import { LoggerModule } from '@modules/logger';
@Module({ imports: [MongooseModule.forFeature([{ name: IntegrationEvent.name, schema: IntegrationEventSchema }]), LoggerModule], providers: [IntegrationEventOutboxService, IntegrationEventDispatcherService, IntegrationEventHandlerRegistryService], exports: [IntegrationEventOutboxService, IntegrationEventHandlerRegistryService] })
export class IntegrationEventsModule {}
