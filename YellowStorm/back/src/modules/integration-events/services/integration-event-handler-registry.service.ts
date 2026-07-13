import { Injectable } from '@nestjs/common';
import type { IntegrationEventHandler } from '../interfaces/integration-event.interface';
@Injectable()
export class IntegrationEventHandlerRegistryService {
  private readonly handlers: IntegrationEventHandler[] = [];
  register(handler: IntegrationEventHandler): void { this.handlers.push(handler); }
  forType(eventType: string): IntegrationEventHandler[] { return this.handlers.filter((handler) => handler.eventTypes.includes(eventType)); }
}
