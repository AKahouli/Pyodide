import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { CryptoService } from '@common/services/crypto.service';
import { AgentService } from '@modules/agent/agent.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import {
  AgentTelegramIntegration,
  AgentTelegramIntegrationDocument,
  TelegramIntegrationStatus,
} from '../schemas/agent-telegram-integration.schema';
import { TelegramChatBinding, TelegramChatBindingDocument } from '../schemas/telegram-chat-binding.schema';
import { TelegramLinkCode, TelegramLinkCodeDocument } from '../schemas/telegram-link-code.schema';
import { UpsertAgentTelegramIntegrationDto } from '../dto/upsert-agent-telegram-integration.dto';
import {
  TelegramIntegrationMessageKey,
  TelegramIntegrationResponseDto,
} from '../dto/telegram-integration-response.dto';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';

@Injectable()
export class TelegramIntegrationService {
  constructor(
    @InjectModel(AgentTelegramIntegration.name)
    private readonly integrationModel: Model<AgentTelegramIntegrationDocument>,
    @InjectModel(TelegramChatBinding.name)
    private readonly bindingModel: Model<TelegramChatBindingDocument>,
    @InjectModel(TelegramLinkCode.name)
    private readonly linkCodeModel: Model<TelegramLinkCodeDocument>,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly agentService: AgentService,
    private readonly telegramApiService: TelegramApiService,
    private readonly linkCodeService: TelegramLinkCodeService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TelegramIntegrationService.name);
  }

  async getByAgentForUser(
    userId: string,
    agentId: string,
  ): Promise<TelegramIntegrationResponseDto | null> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationModel
      .findOne({ agentId: new Types.ObjectId(agentId) })
      .lean()
      .exec();
    return integration ? this.toResponse(integration) : null;
  }

  async upsertForAgent(
    userId: string,
    agentId: string,
    dto: UpsertAgentTelegramIntegrationDto,
  ): Promise<TelegramIntegrationResponseDto> {
    await this.assertAgentOwnership(userId, agentId);

    this.logger.log('Telegram integration upsert started', {
      userId,
      agentId,
      enabled: dto.enabled,
      tokenProvided: !!dto.botToken,
    });

    const existing = await this.integrationModel
      .findOne({ agentId: new Types.ObjectId(agentId) })
      .exec();

    if (!existing && !dto.botToken) {
      throw new BadRequestException(
        ErrorCode.TELEGRAM_TOKEN_INVALID,
        'Telegram bot token is required for first setup',
      );
    }

    if (dto.enabled && !dto.botToken && !existing?.encryptedBotToken) {
      throw new BadRequestException(
        ErrorCode.TELEGRAM_TOKEN_INVALID,
        'Telegram bot token is required when enabling integration',
      );
    }

    const integration = existing ?? new this.integrationModel();
    integration.userId = new Types.ObjectId(userId);
    integration.agentId = new Types.ObjectId(agentId);
    integration.enabled = dto.enabled;
    integration.status = TelegramIntegrationStatus.PENDING;
    integration.errorMessage = undefined;
    if (!integration.webhookSecret) {
      integration.webhookSecret = this.generateWebhookSecret();
    }

    if (dto.botToken) {
      this.logger.log('Validating Telegram bot token via getMe', {
        userId,
        agentId,
        integrationId: integration._id?.toString(),
        isNewIntegration: !existing,
      });
      integration.encryptedBotToken = this.cryptoService.encrypt(dto.botToken);
      const me = await this.telegramApiService.getMe(dto.botToken);
      integration.botUsername = me.username;
      this.logger.log('Telegram bot token validated', {
        userId,
        agentId,
        integrationId: integration._id?.toString(),
        botUsername: me.username,
        botId: me.id,
      });
    }

    const saved = await integration.save();
    this.logger.log('Telegram integration saved, syncing webhook state', {
      userId,
      agentId,
      integrationId: saved._id.toString(),
      enabled: saved.enabled,
      botUsername: saved.botUsername,
      hasToken: !!saved.encryptedBotToken,
    });
    const response = await this.syncWebhookState(saved);
    this.logger.log('Telegram integration upsert completed', {
      userId,
      agentId,
      integrationId: saved._id.toString(),
      status: response.status,
      messageKey: response.messageKey,
      webhookRegistered: response.webhookRegistered,
      botUsername: response.botUsername,
      linkCodeExpiresAt: response.linkCodeExpiresAt,
      errorMessage: response.errorMessage,
    });
    return response;
  }

  async registerWebhookForAgent(userId: string, agentId: string): Promise<void> {
    const integration = await this.getIntegrationForAgent(userId, agentId);
    if (!integration.enabled) {
      throw new BadRequestException(
        ErrorCode.TELEGRAM_INTEGRATION_DISABLED,
        'Telegram integration is disabled for this agent',
      );
    }
    await this.registerWebhook(integration);
    integration.status = TelegramIntegrationStatus.ACTIVE;
    integration.errorMessage = undefined;
    await integration.save();
  }

  async deleteForAgent(userId: string, agentId: string): Promise<void> {
    const integration = await this.getIntegrationForAgent(userId, agentId);
    await this.clearWebhook(integration);
    await Promise.all([
      this.bindingModel.deleteMany({ integrationId: integration._id }).exec(),
      this.linkCodeModel.deleteMany({ integrationId: integration._id }).exec(),
      this.integrationModel.deleteOne({ _id: integration._id }).exec(),
    ]);
  }

  async getByIntegrationId(integrationId: string): Promise<AgentTelegramIntegrationDocument> {
    const integration = await this.integrationModel.findById(integrationId).exec();
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.TELEGRAM_INTEGRATION_NOT_FOUND,
        'Telegram integration not found',
      );
    }
    return integration;
  }

  async getDocumentByAgentForUser(
    userId: string,
    agentId: string,
  ): Promise<AgentTelegramIntegrationDocument> {
    return this.getIntegrationForAgent(userId, agentId);
  }

  async validateWebhookSecret(
    integrationId: string,
    secretToken: string | undefined,
  ): Promise<AgentTelegramIntegrationDocument> {
    const integration = await this.getByIntegrationId(integrationId);
    if (!secretToken || secretToken !== integration.webhookSecret) {
      throw new UnauthorizedException(
        ErrorCode.TELEGRAM_WEBHOOK_UNAUTHORIZED,
        'Invalid Telegram webhook secret token',
      );
    }
    return integration;
  }

  async markWebhookUpdate(
    integrationId: string,
    updateId?: number,
  ): Promise<'processed' | 'duplicate'> {
    if (updateId === undefined || updateId === null) {
      await this.integrationModel.findByIdAndUpdate(integrationId, { lastWebhookAt: new Date() }).exec();
      return 'processed';
    }
    const updated = await this.integrationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(integrationId),
        $or: [{ lastUpdateId: { $exists: false } }, { lastUpdateId: { $lt: updateId } }],
      },
      { $set: { lastUpdateId: updateId, lastWebhookAt: new Date() } },
      { new: true },
    );
    return updated ? 'processed' : 'duplicate';
  }

  getDecryptedToken(integration: AgentTelegramIntegrationDocument): string {
    return this.cryptoService.decrypt(integration.encryptedBotToken);
  }

  private async syncWebhookState(
    integration: AgentTelegramIntegrationDocument,
  ): Promise<TelegramIntegrationResponseDto> {
    let webhookRegistered = false;
    let messageKey: TelegramIntegrationMessageKey = 'saved';
    let linkCode: string | undefined;
    let linkCodeExpiresAt: string | undefined;

    this.logger.log('Telegram webhook sync started', {
      integrationId: integration._id.toString(),
      agentId: integration.agentId.toString(),
      enabled: integration.enabled,
      hasToken: !!integration.encryptedBotToken,
      botUsername: integration.botUsername,
    });

    if (integration.enabled && integration.encryptedBotToken) {
      try {
        const webhookUrl = await this.registerWebhook(integration);
        integration.status = TelegramIntegrationStatus.ACTIVE;
        integration.errorMessage = undefined;
        webhookRegistered = true;
        messageKey = 'webhook_success';

        this.logger.log('Telegram webhook registered successfully', {
          integrationId: integration._id.toString(),
          agentId: integration.agentId.toString(),
          webhookUrl,
          botUsername: integration.botUsername,
        });

        const linkCodeResult = await this.linkCodeService.generateForIntegration(integration);
        linkCode = linkCodeResult.code;
        linkCodeExpiresAt = linkCodeResult.expiresAt;

        this.logger.log('Telegram link code generated for chat binding', {
          integrationId: integration._id.toString(),
          agentId: integration.agentId.toString(),
          linkCode,
          expiresAt: linkCodeExpiresAt,
        });
      } catch (error) {
        integration.status = TelegramIntegrationStatus.ERROR;
        integration.errorMessage = (error as Error).message;
        messageKey = 'webhook_failed';
        this.logger.warn('Telegram webhook auto-registration failed during upsert', {
          integrationId: integration._id.toString(),
          agentId: integration.agentId.toString(),
          botUsername: integration.botUsername,
          error: (error as Error).message,
        });
      }
    } else if (!integration.enabled && integration.encryptedBotToken) {
      this.logger.log('Telegram integration disabled, clearing webhook', {
        integrationId: integration._id.toString(),
        agentId: integration.agentId.toString(),
      });
      await this.clearWebhook(integration);
      integration.status = TelegramIntegrationStatus.PENDING;
      integration.errorMessage = undefined;
      messageKey = 'disabled';
    } else {
      this.logger.log('Telegram webhook sync skipped', {
        integrationId: integration._id.toString(),
        agentId: integration.agentId.toString(),
        enabled: integration.enabled,
        hasToken: !!integration.encryptedBotToken,
        reason: !integration.enabled ? 'integration_disabled' : 'no_bot_token',
      });
    }

    await integration.save();

    return this.toResponse(integration.toObject(), {
      webhookRegistered,
      messageKey,
      linkCode,
      linkCodeExpiresAt,
    });
  }

  private async registerWebhook(integration: AgentTelegramIntegrationDocument): Promise<string> {
    const botToken = this.cryptoService.decrypt(integration.encryptedBotToken);
    const backendUrl = this.configService.get<string>('app.backendUrl', '').replace(/\/+$/, '');
    if (!backendUrl) {
      this.logger.warn('Telegram webhook registration blocked: BACKEND_URL missing', {
        integrationId: integration._id.toString(),
        agentId: integration.agentId.toString(),
      });
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'BACKEND_URL must be configured to register Telegram webhook',
      );
    }
    const webhookPath = `/api/v1/integrations/telegram/webhook/${integration._id.toString()}`;
    const webhookUrl = `${backendUrl}${webhookPath}`;

    this.logger.log('Registering Telegram webhook with Telegram API', {
      integrationId: integration._id.toString(),
      agentId: integration.agentId.toString(),
      webhookUrl,
      botUsername: integration.botUsername,
      hasWebhookSecret: !!integration.webhookSecret,
    });

    await this.telegramApiService.setWebhook(botToken, webhookUrl, integration.webhookSecret);
    return webhookUrl;
  }

  private async clearWebhook(integration: AgentTelegramIntegrationDocument): Promise<void> {
    if (!integration.encryptedBotToken) {
      return;
    }
    try {
      this.logger.log('Deleting Telegram webhook via Telegram API', {
        integrationId: integration._id.toString(),
        agentId: integration.agentId.toString(),
        botUsername: integration.botUsername,
      });
      const token = this.cryptoService.decrypt(integration.encryptedBotToken);
      await this.telegramApiService.deleteWebhook(token);
      this.logger.log('Telegram webhook deleted', {
        integrationId: integration._id.toString(),
        agentId: integration.agentId.toString(),
      });
    } catch (error) {
      this.logger.warn('Failed to delete Telegram webhook', {
        integrationId: integration._id.toString(),
        agentId: integration.agentId.toString(),
        error: (error as Error).message,
      });
    }
  }

  private async getIntegrationForAgent(
    userId: string,
    agentId: string,
  ): Promise<AgentTelegramIntegrationDocument> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationModel
      .findOne({ agentId: new Types.ObjectId(agentId) })
      .exec();
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.TELEGRAM_INTEGRATION_NOT_FOUND,
        'Telegram integration not found for this agent',
      );
    }
    return integration;
  }

  private async assertAgentOwnership(userId: string, agentId: string): Promise<void> {
    try {
      await this.agentService.findUserAgentById(userId, agentId);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      throw new ForbiddenException(
        ErrorCode.CUSTOM_AGENT_FORBIDDEN,
        'You do not have access to this agent',
      );
    }
  }

  private toResponse(
    integration: {
      enabled: boolean;
      encryptedBotToken: string;
      botUsername?: string;
      status?: string;
      errorMessage?: string;
      updatedAt?: Date;
    },
    extras?: {
      webhookRegistered?: boolean;
      messageKey?: TelegramIntegrationMessageKey;
      linkCode?: string;
      linkCodeExpiresAt?: string;
    },
  ): TelegramIntegrationResponseDto {
    return {
      enabled: integration.enabled,
      hasToken: !!integration.encryptedBotToken,
      botUsername: integration.botUsername,
      status: integration.status as TelegramIntegrationResponseDto['status'],
      errorMessage: integration.errorMessage,
      updatedAt: integration.updatedAt?.toISOString(),
      webhookRegistered: extras?.webhookRegistered,
      messageKey: extras?.messageKey,
      linkCode: extras?.linkCode,
      linkCodeExpiresAt: extras?.linkCodeExpiresAt,
    };
  }

  private generateWebhookSecret(): string {
    return `${randomUUID().replace(/-/g, '')}${randomBytes(8).toString('hex')}`;
  }
}
