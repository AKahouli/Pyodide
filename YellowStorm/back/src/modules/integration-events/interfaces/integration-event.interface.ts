export type IntegrationEventStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
export interface NewIntegrationEvent { eventId: string; eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown>; occurredAt?: Date; correlationId?: string; causationId?: string; }
export interface IntegrationEventEnvelope<T = Record<string, unknown>> extends Omit<NewIntegrationEvent, 'payload'> { payload: T; occurredAt: Date; }
export interface IntegrationEventHandler<T = Record<string, unknown>> { eventTypes: string[]; handle(event: IntegrationEventEnvelope<T>): Promise<void>; }
