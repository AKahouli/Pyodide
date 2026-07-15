import type { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';

export type WhatsAppIntegrationSseEventType = 'status' | 'heartbeat';

export interface WhatsAppIntegrationSseEvent {
  type: WhatsAppIntegrationSseEventType;
  agentId: string;
  data: WhatsAppIntegrationResponseDto | { timestamp: number };
}
