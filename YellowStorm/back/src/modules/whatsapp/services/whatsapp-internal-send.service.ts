import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  AppException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  TooManyRequestsException,
} from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { isWhatsAppTransportError } from '../baileys/whatsapp-network.util';
import {
  AgentWhatsAppIntegration,
  AgentWhatsAppIntegrationDocument,
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import {
  WhatsAppChatBinding,
  WhatsAppChatBindingDocument,
} from '../schemas/whatsapp-chat-binding.schema';
import { normalizeWhatsappUserJid } from '../utils/whatsapp-user-jid.util';
import { WhatsAppSessionManager } from './whatsapp-session.manager';

export interface InternalWhatsAppSendResult {
  messageId: string | undefined;
  status: 'SENT';
  to: string;
}

export interface InternalWhatsAppStatusResult {
  enabled: boolean;
  status: WhatsAppIntegrationStatus;
  phoneNumber?: string;
}

/**
 * Backing service for the internal send endpoint consumed by the standalone
 * WhatsApp Send MCP façade. The backend stays the sole Baileys owner: this
 * only resolves the agent's paired session and guards the recipient
 * allow-list before handing off to WhatsAppSessionManager.
 */
@Injectable()
export class WhatsAppInternalSendService {
  private readonly sendTimestamps = new Map<string, number[]>();

  constructor(
    @InjectModel(AgentWhatsAppIntegration.name)
    private readonly integrationModel: Model<AgentWhatsAppIntegrationDocument>,
    @InjectModel(WhatsAppChatBinding.name)
    private readonly bindingModel: Model<WhatsAppChatBindingDocument>,
    private readonly sessionManager: WhatsAppSessionManager,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppInternalSendService.name);
  }

  async send(params: { agentId: string; to?: string; text: string }): Promise<InternalWhatsAppSendResult> {
    const integration = await this.resolveIntegration(params.agentId);
    this.assertRateLimit(params.agentId);

    const remoteJid = await this.resolveRecipientJid(integration, params.to);
    const text = this.truncateText(params.text);

    let messageId: string | undefined;
    try {
      messageId = await this.sessionManager.sendAgentMessage(integration._id, remoteJid, text);
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (isWhatsAppTransportError(message)) {
        throw new ServiceUnavailableException(
          ErrorCode.WHATSAPP_NETWORK_UNREACHABLE,
          'Cannot reach web.whatsapp.com',
        );
      }
      throw new BadGatewayException(ErrorCode.WHATSAPP_SEND_FAILED, 'Failed to send message to WhatsApp');
    }

    const now = new Date();
    await Promise.all([
      this.bindingModel.updateOne(
        { integrationId: integration._id, remoteJid },
        { $set: { lastMessageAt: now } },
      ),
      this.integrationModel.updateOne(
        { _id: integration._id },
        { $set: { lastActivityAt: now } },
      ),
    ]);

    return { messageId, status: 'SENT', to: remoteJid };
  }

  async getStatus(agentId: string): Promise<InternalWhatsAppStatusResult> {
    const integration = await this.findIntegration(agentId);
    if (!integration) {
      throw new ConflictException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'WhatsApp integration not found for this agent',
      );
    }
    return {
      enabled: integration.enabled !== false,
      status: integration.status,
      phoneNumber: integration.phoneNumber,
    };
  }

  private async resolveIntegration(agentId: string): Promise<AgentWhatsAppIntegrationDocument> {
    const integration = await this.findIntegration(agentId);
    if (!integration) {
      throw new ConflictException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'WhatsApp integration not found for this agent',
      );
    }
    if (!integration.enabled) {
      throw new ConflictException(ErrorCode.WHATSAPP_DISABLED, 'WhatsApp integration is disabled');
    }
    if (integration.status !== WhatsAppIntegrationStatus.CONNECTED) {
      throw new ConflictException(
        ErrorCode.WHATSAPP_SESSION_NOT_FOUND,
        `WhatsApp session is ${integration.status}, not CONNECTED`,
      );
    }
    return integration;
  }

  private async findIntegration(
    agentId: string,
  ): Promise<AgentWhatsAppIntegrationDocument | null> {
    return this.integrationModel
      .findOne({ agentId: new Types.ObjectId(agentId) })
      .exec();
  }

  /**
   * Explicit `to` (JID or E.164) wins, but must already be a known binding —
   * no cold outreach (ban risk). Without `to`, the agent's most recently
   * active binding is used.
   */
  private async resolveRecipientJid(
    integration: AgentWhatsAppIntegrationDocument,
    to?: string,
  ): Promise<string> {
    if (to) {
      const remoteJid = normalizeWhatsappUserJid(to);
      const binding = await this.bindingModel
        .findOne({ integrationId: integration._id, remoteJid })
        .select({ _id: 1 })
        .lean()
        .exec();
      if (!binding) {
        throw new ForbiddenException(
          ErrorCode.FORBIDDEN,
          'Recipient is not a known WhatsApp contact for this agent',
        );
      }
      return remoteJid;
    }

    const latest = await this.bindingModel
      .findOne({ integrationId: integration._id })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .select({ remoteJid: 1 })
      .lean()
      .exec();
    if (!latest) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        'No known WhatsApp recipient for this agent',
      );
    }
    return latest.remoteJid;
  }

  private assertRateLimit(agentId: string): void {
    const limit = this.configService.get<number>('whatsapp.internalSendRateLimitPerMinute', 30);
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (this.sendTimestamps.get(agentId) ?? []).filter((ts) => ts > windowStart);
    if (timestamps.length >= limit) {
      this.logger.warn('WhatsApp internal send rate limited', { agentId, limit });
      throw new TooManyRequestsException(
        `WhatsApp send rate limit exceeded (${limit} per minute)`,
      );
    }
    timestamps.push(now);
    this.sendTimestamps.set(agentId, timestamps);
  }

  private truncateText(text: string): string {
    const maxLength = this.configService.get<number>('whatsapp.maxReplyLength', 4000);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
  }
}
