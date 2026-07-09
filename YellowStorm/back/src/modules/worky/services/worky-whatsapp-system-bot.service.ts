import { Injectable } from '@nestjs/common';
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
  ) {}

  normalizePhoneDigits(phone: string): string {
    return phone.replace(/\D/g, '');
  }

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

  async updateExpectedPairingPhone(
    phoneNumber: string,
  ): Promise<WorkyWhatsAppSystemBotDocument> {
    const digits = this.normalizePhoneDigits(phoneNumber);
    if (digits.length < 8 || digits.length > 15) {
      throw new BadRequestException(
        ErrorCode.VALIDATION_ERROR,
        'Phone number must contain 8 to 15 digits',
      );
    }
    return this.systemBotModel
      .findOneAndUpdate(
        { key: WORKY_WHATSAPP_SYSTEM_BOT_KEY },
        { $set: { expectedPairingPhone: digits } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
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

  async getExpectedPhoneDigits(): Promise<string | null> {
    const doc = await this.getOrCreateDocument();
    const digits = this.normalizePhoneDigits(doc.expectedPairingPhone ?? '');
    return digits || null;
  }

  async assertExpectedPhoneConfigured(): Promise<void> {
    const expectedDigits = await this.getExpectedPhoneDigits();
    if (!expectedDigits) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_NOT_CONFIGURED,
        'System bot phone is not configured',
      );
    }
  }

  /**
   * Validates that the paired phone matches the admin-configured expectedPairingPhone.
   */
  async assertExpectedPhone(phoneNumber: string | undefined): Promise<void> {
    const expectedDigits = await this.getExpectedPhoneDigits();
    if (!expectedDigits) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_NOT_CONFIGURED,
        'System bot phone is not configured',
      );
    }
    const actualDigits = this.normalizePhoneDigits(phoneNumber ?? '');
    if (!actualDigits || actualDigits !== expectedDigits) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SYSTEM_BOT_PHONE_MISMATCH,
        `Paired number must be ${expectedDigits}`,
      );
    }
  }

  toResponse(integration: {
    enabled?: boolean;
    status: WhatsAppIntegrationStatus;
    sessionId?: string;
    phoneNumber?: string;
    expectedPairingPhone?: string;
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
      expectedPairingPhone: integration.expectedPairingPhone,
      displayName: integration.displayName,
      errorMessage: integration.errorMessage,
      lastActivityAt: integration.lastActivityAt?.toISOString(),
      updatedAt: integration.updatedAt?.toISOString(),
    };
  }
}
