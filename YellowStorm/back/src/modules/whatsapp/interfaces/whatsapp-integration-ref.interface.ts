import { Types } from 'mongoose';

import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';

import type { AgentWhatsAppIntegrationDocument } from '../schemas/agent-whatsapp-integration.schema';

import type { WorkyWhatsAppIntegrationDocument } from '@modules/worky/schemas/worky-whatsapp-integration.schema';
import type { WorkyWhatsAppSystemBotDocument } from '@modules/worky/schemas/worky-whatsapp-system-bot.schema';

export type WhatsAppIntegrationKind = 'agent' | 'worky_stream' | 'worky_system_bot';

export interface WhatsAppIntegrationRef {
  kind: WhatsAppIntegrationKind;
  integrationId: Types.ObjectId;
  userId: Types.ObjectId;
  agentId?: Types.ObjectId;
  workyStreamId?: Types.ObjectId;
  status: WhatsAppIntegrationStatus;
  enabled: boolean;
  sessionId?: string;
  phoneNumber?: string;
  /** JID of the WhatsApp group bridging messages to Worky (populated after group creation). */
  workyGroupJid?: string;
}

export function toAgentIntegrationRef(
  integration: AgentWhatsAppIntegrationDocument,
): WhatsAppIntegrationRef {
  return {
    kind: 'agent',
    integrationId: integration._id as Types.ObjectId,
    userId: integration.userId,
    agentId: integration.agentId,
    status: integration.status,
    enabled: integration.enabled,
    sessionId: integration.sessionId,
    phoneNumber: integration.phoneNumber,
  };
}

export function toWorkyIntegrationRef(
  integration: WorkyWhatsAppIntegrationDocument,
): WhatsAppIntegrationRef {
  return {
    kind: 'worky_stream',
    integrationId: integration._id as Types.ObjectId,
    userId: integration.userId,
    workyStreamId: integration.streamId,
    status: integration.status,
    enabled: integration.enabled,
    sessionId: integration.sessionId,
    phoneNumber: integration.phoneNumber,
    workyGroupJid: integration.workyGroupJid,
  };
}

export function toSystemBotIntegrationRef(
  integration: WorkyWhatsAppSystemBotDocument,
  pairedByUserId: Types.ObjectId,
): WhatsAppIntegrationRef {
  return {
    kind: 'worky_system_bot',
    integrationId: integration._id as Types.ObjectId,
    userId: pairedByUserId,
    status: integration.status,
    enabled: integration.enabled,
    sessionId: integration.sessionId,
    phoneNumber: integration.phoneNumber,
  };
}
