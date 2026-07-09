import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WhatsAppIntegrationResponseDto } from '@modules/whatsapp/dto/whatsapp-integration-response.dto';
import { WhatsAppIntegrationStatus } from '@modules/whatsapp/schemas/agent-whatsapp-integration.schema';
import { WorkyStreamService } from './worky-stream.service';
import {
  WorkyWhatsAppIntegration,
  WorkyWhatsAppIntegrationDocument,
} from '../schemas/worky-whatsapp-integration.schema';

@Injectable()
export class WorkyWhatsAppIntegrationService {
  constructor(
    @InjectModel(WorkyWhatsAppIntegration.name)
    private readonly integrationModel: Model<WorkyWhatsAppIntegrationDocument>,
    private readonly streamService: WorkyStreamService,
  ) {}

  async getByStreamForUser(
    userId: string,
    streamId: string,
  ): Promise<WhatsAppIntegrationResponseDto | null> {
    await this.assertStreamOwnership(userId, streamId);
    const integration = await this.integrationModel
      .findOne({ streamId: new Types.ObjectId(streamId) })
      .lean()
      .exec();
    return integration ? this.toResponse(integration) : null;
  }

  async getDocumentByStreamForUser(
    userId: string,
    streamId: string,
  ): Promise<WorkyWhatsAppIntegrationDocument> {
    await this.assertStreamOwnership(userId, streamId);
    const integration = await this.integrationModel
      .findOne({ streamId: new Types.ObjectId(streamId) })
      .exec();
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'WhatsApp integration not found for this stream',
      );
    }
    return integration;
  }

  async getDocumentBySessionForUser(
    userId: string,
    streamId: string,
    sessionId: string,
  ): Promise<WorkyWhatsAppIntegrationDocument> {
    const integration = await this.getDocumentByStreamForUser(userId, streamId);
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
  ): Promise<WorkyWhatsAppIntegrationDocument> {
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
    streamId: string,
    sessionId: string,
  ): Promise<WorkyWhatsAppIntegrationDocument> {
    await this.assertStreamOwnership(userId, streamId);
    return this.integrationModel
      .findOneAndUpdate(
        { streamId: new Types.ObjectId(streamId) },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            streamId: new Types.ObjectId(streamId),
            sessionId,
            status: WhatsAppIntegrationStatus.PAIRING,
            errorMessage: undefined,
            enabled: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
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

  async updateGroupJid(integrationId: Types.ObjectId, workyGroupJid: string): Promise<void> {
    await this.integrationModel.updateOne({ _id: integrationId }, { $set: { workyGroupJid } }).exec();
  }

  async updateUserWhatsappJid(
    integrationId: Types.ObjectId,
    userWhatsappJid: string,
  ): Promise<void> {
    await this.integrationModel
      .updateOne({ _id: integrationId }, { $set: { userWhatsappJid } })
      .exec();
  }

  async clearGroupJid(integrationId: Types.ObjectId): Promise<void> {
    await this.integrationModel
      .updateOne({ _id: integrationId }, { $unset: { workyGroupJid: '' } })
      .exec();
  }

  async resolveGroupJidByStreamId(streamId: string): Promise<string | undefined> {
    const integration = await this.integrationModel
      .findOne({ streamId: new Types.ObjectId(streamId) })
      .select('workyGroupJid')
      .lean()
      .exec();
    return integration?.workyGroupJid;
  }

  async getDocumentByStreamId(streamId: string): Promise<WorkyWhatsAppIntegrationDocument | null> {
    return this.integrationModel.findOne({ streamId: new Types.ObjectId(streamId) }).exec();
  }

  /** Returns the stream title to use as the WhatsApp group name, falling back to 'Worky'. */
  async findStreamTitle(userId: string, streamId: Types.ObjectId): Promise<string> {
    try {
      const stream = await this.streamService.findById(userId, streamId.toString());
      return stream.title?.trim() || 'Worky';
    } catch {
      return 'Worky';
    }
  }

  async deleteIntegrationDocument(integration: WorkyWhatsAppIntegrationDocument): Promise<void> {
    await this.integrationModel.deleteOne({ _id: integration._id }).exec();
  }

  async findConnectedIntegrations(): Promise<WorkyWhatsAppIntegrationDocument[]> {
    return this.integrationModel
      .find({
        status: WhatsAppIntegrationStatus.CONNECTED,
        enabled: true,
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

  private async assertStreamOwnership(userId: string, streamId: string): Promise<void> {
    await this.streamService.findById(userId, streamId);
  }
}
