import { Injectable } from '@nestjs/common';
import type { IntegrationEventHandler } from '../interfaces/integration-event.interface';
@Injectable()
export class IntegrationEventHandlerRegistryService {
  private readonly handlers: IntegrationEventHandler[] = [];
  register(handler: IntegrationEventHandler): void { if (this.handlers.some((registered) => registered.handlerKey === handler.handlerKey)) throw new Error(`Duplicate integration-event handler key: ${handler.handlerKey}`); this.handlers.push(handler); }
  forType(eventType: string): IntegrationEventHandler[] { return this.handlers.filter((handler) => handler.eventTypes.includes(eventType)); }
}
