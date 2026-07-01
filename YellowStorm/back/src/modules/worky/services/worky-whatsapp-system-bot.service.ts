import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WhatsAppIntegrationResponseDto } from '@modules/whatsapp/dto/whatsapp-integration-response.dto';
import { WhatsAppIntegrationStatus } from '@modules/whatsapp/schemas/agent-whatsapp-integration.schema';
import {
  WORKY_WHATSAPP_SYSTEM_BOT_KEY,
  WorkyWhatsAppSystemBot,
  WorkyWhatsAppSystemBotDocument,
} from '../schemas/worky-whatsapp-system-bot.schema';

@Injectable()
export class WorkyWhatsAppSystemBotService {
  constructor(
    @InjectModel(WorkyWhatsAppSystemBot.name)
    private readonly systemBotModel: Model<WorkyWhatsAppSystemBotDocument>,
    private readonly configService: ConfigService,
  ) {}

  async getOrCreateDocument(): Promise<WorkyWhatsAppSystemBotDocument> {
    const existing = await this.systemBotModel
      .findOne({ key: WORKY_WHATSAPP_SYSTEM_BOT_KEY })
      .exec();
    if (existing) {
      return existing;
    }
    return this.systemBotModel.create({ key: WORKY_WHATSAPP_SYSTEM_BOT_KEY });
  }

  async getStatus(): Promise<WhatsAppIntegrationResponseDto> {
    const doc = await this.getOrCreateDocument();
    return this.toResponse(doc);
  }

  async getDocumentBySession(sessionId: string): Promise<WorkyWhatsAppSystemBotDocument> {
    const doc = await this.systemBotModel.findOne({ sessionId }).exec();
    if (!doc) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SESSION_NOT_FOUND,
        'WhatsApp system bot session not found',
      );
    }
    return doc;
  }

  async upsertPairingShell(
    pairedByUserId: string,
    sessionId: string,
  ): Promise<WorkyWhatsAppSystemBotDocument> {
    return this.systemBotModel
      .findOneAndUpdate(
        { key: WORKY_WHATSAPP_SYSTEM_BOT_KEY },
        {
          $set: {
            pairedByUserId: new Types.ObjectId(pairedByUserId),
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
      pairedByUserId: Types.ObjectId;
    }>,
  ): Promise<void> {
    await this.systemBotModel.updateOne({ _id: integrationId }, { $set: patch }).exec();
  }

  async findConnected(): Promise<WorkyWhatsAppSystemBotDocument | null> {
    return this.systemBotModel
      .findOne({
        key: WORKY_WHATSAPP_SYSTEM_BOT_KEY,
        status: WhatsAppIntegrationStatus.CONNECTED,
        enabled: true,
      })
      .exec();
  }

  isConnected(doc?: Pick<WorkyWhatsAppSystemBotDocument, 'status'> | null): boolean {
    return doc?.status === WhatsAppIntegrationStatus.CONNECTED;
  }

  async assertConnected(): Promise<WorkyWhatsAppSystemBotDocument> {
    const doc = await this.findConnected();
    if (!doc) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SYSTEM_BOT_NOT_CONNECTED,
        'Worky WhatsApp system bot is not connected',
      );
    }
    return doc;
  }

  /**
   * Validates that the paired phone matches WHATSAPP_WORKY_GROUP_PHONE.
   * Throws if digits differ.
   */
  assertExpectedPhone(phoneNumber: string | undefined): void {
    const expected = this.configService.get<string>('whatsapp.workyGroupPhone', '21651856582');
    const expectedDigits = expected.replace(/\D/g, '');
    const actualDigits = (phoneNumber ?? '').replace(/\D/g, '');
    if (!actualDigits || actualDigits !== expectedDigits) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_MISMATCH,
        `Paired number must be ${expectedDigits}`,
      );
    }
  }

  getExpectedPhoneDigits(): string {
    const expected = this.configService.get<string>('whatsapp.workyGroupPhone', '21651856582');
    return expected.replace(/\D/g, '');
  }

  toResponse(integration: {
    status: WhatsAppIntegrationStatus;
    sessionId?: string;
    phoneNumber?: string;
    displayName?: string;
    errorMessage?: string;
    lastActivityAt?: Date;
    updatedAt?: Date;
  }): WhatsAppIntegrationResponseDto {
    return {
      status: integration.status,
      sessionId: integration.sessionId,
      phoneNumber: integration.phoneNumber,
      displayName: integration.displayName,
      errorMessage: integration.errorMessage,
      lastActivityAt: integration.lastActivityAt?.toISOString(),
      updatedAt: integration.updatedAt?.toISOString(),
    };
  }
}
