import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AgentService } from '@modules/agent/agent.service';
import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import {
  AgentWhatsAppIntegration,
  AgentWhatsAppIntegrationDocument,
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingDocument } from '../schemas/whatsapp-chat-binding.schema';

@Injectable()
export class WhatsAppIntegrationService {
  constructor(
    @InjectModel(AgentWhatsAppIntegration.name)
    private readonly integrationModel: Model<AgentWhatsAppIntegrationDocument>,
    @InjectModel(WhatsAppChatBinding.name)
    private readonly bindingModel: Model<WhatsAppChatBindingDocument>,
    private readonly agentService: AgentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppIntegrationService.name);
  }

  async getByAgentForUser(
    userId: string,
    agentId: string,
  ): Promise<WhatsAppIntegrationResponseDto | null> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationModel
      .findOne({ agentId: new Types.ObjectId(agentId) })
      .lean()
      .exec();
    return integration ? this.toResponse(integration) : null;
  }

  async getDocumentByAgentForUser(
    userId: string,
    agentId: string,
  ): Promise<AgentWhatsAppIntegrationDocument> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationModel
      .findOne({ agentId: new Types.ObjectId(agentId) })
      .exec();
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'WhatsApp integration not found for this agent',
      );
    }
    return integration;
  }

  async getDocumentBySessionForUser(
    userId: string,
    agentId: string,
    sessionId: string,
  ): Promise<AgentWhatsAppIntegrationDocument> {
    const integration = await this.getDocumentByAgentForUser(userId, agentId);
    if (integration.sessionId !== sessionId) {
      throw new NotFoundException(
        ErrorCode.WHATSAPP_SESSION_NOT_FOUND,
        'WhatsApp session not found',
      );
    }
    return integration;
  }

  async getDocumentById(
    integrationId: Types.ObjectId,
  ): Promise<AgentWhatsAppIntegrationDocument> {
    const integration = await this.integrationModel.findById(integrationId).exec();
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'WhatsApp integration not found',
      );
    }
    return integration;
  }

  async upsertIntegrationShell(
    userId: string,
    agentId: string,
    sessionId: string,
  ): Promise<AgentWhatsAppIntegrationDocument> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationModel
      .findOneAndUpdate(
        { agentId: new Types.ObjectId(agentId) },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            agentId: new Types.ObjectId(agentId),
            sessionId,
            status: WhatsAppIntegrationStatus.PAIRING,
            errorMessage: undefined,
            enabled: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return integration;
  }

  async updateStatus(
    integrationId: Types.ObjectId,
    patch: Partial<{
      status: WhatsAppIntegrationStatus;
      sessionId: string;
      phoneNumber: string;
      displayName: string;
      errorMessage: string;
      lastActivityAt: Date;
    }>,
  ): Promise<void> {
    await this.integrationModel.updateOne({ _id: integrationId }, { $set: patch }).exec();
  }

  async deleteIntegrationForAgent(userId: string, agentId: string): Promise<void> {
    const integration = await this.getDocumentByAgentForUser(userId, agentId);
    await this.bindingModel.deleteMany({ integrationId: integration._id }).exec();
    await this.integrationModel.deleteOne({ _id: integration._id }).exec();
  }

  async updateEnabled(
    userId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<WhatsAppIntegrationResponseDto> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationModel
      .findOneAndUpdate(
        { agentId: new Types.ObjectId(agentId) },
        { $set: { enabled } },
        { new: true },
      )
      .exec();
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'WhatsApp integration not found for this agent',
      );
    }
    return this.toResponse(integration);
  }

  async findConnectedIntegrations(): Promise<AgentWhatsAppIntegrationDocument[]> {
    return this.integrationModel
      .find({
        status: WhatsAppIntegrationStatus.CONNECTED,
        enabled: true,
      })
      .exec();
  }

  async findRecoverableIntegrations(): Promise<AgentWhatsAppIntegrationDocument[]> {
    return this.integrationModel
      .find({
        enabled: true,
        sessionId: { $exists: true, $ne: null },
        status: {
          $in: [WhatsAppIntegrationStatus.FAILED, WhatsAppIntegrationStatus.DISCONNECTED],
        },
      })
      .exec();
  }

  toResponse(integration: {
    enabled?: boolean;
    status: WhatsAppIntegrationStatus;
    sessionId?: string;
    phoneNumber?: string;
    displayName?: string;
    errorMessage?: string;
    lastActivityAt?: Date;
    updatedAt?: Date;
  }): WhatsAppIntegrationResponseDto {
    return {
      enabled: integration.enabled !== false,
      status: integration.status,
      sessionId: integration.sessionId,
      phoneNumber: integration.phoneNumber,
      displayName: integration.displayName,
      errorMessage: integration.errorMessage,
      lastActivityAt: integration.lastActivityAt?.toISOString(),
      updatedAt: integration.updatedAt?.toISOString(),
    };
  }

  private async assertAgentOwnership(userId: string, agentId: string): Promise<void> {
    try {
      await this.agentService.findUserAgentById(userId, agentId);
    } catch {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        'You do not have access to this agent',
      );
    }
  }
}
