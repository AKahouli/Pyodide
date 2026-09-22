import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { stripTrailingChar } from '@common/utils';
import { isObjectId } from '@common/postgres';
import { TelegramIntegrationStatus } from '../telegram.types';
import { UpsertAgentTelegramIntegrationDto } from '../dto/upsert-agent-telegram-integration.dto';
import {
  TelegramIntegrationMessageKey,
  TelegramIntegrationResponseDto,
} from '../dto/telegram-integration-response.dto';
import { TelegramApiService } from './telegram-api.service';
import { TelegramLinkCodeService } from './telegram-link-code.service';
import { TELEGRAM_INTEGRATION_STORE, type TelegramIntegrationRow, type TelegramIntegrationStore } from '../persistence/telegram.store';

@Injectable()
export class TelegramIntegrationService {
  constructor(
    @Inject(TELEGRAM_INTEGRATION_STORE)
    private readonly integrationStore: TelegramIntegrationStore,
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
    const integration = await this.integrationStore.findByAgent(agentId);
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

    const existing = await this.integrationStore.findByAgent(agentId);

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

    // Pending fields; written once below (document save() parity).
    let encryptedBotToken = existing?.encryptedBotToken ?? '';
    let botUsername = existing?.botUsername ?? null;

    if (dto.botToken) {
      this.logger.log('Validating Telegram bot token via getMe', {
        userId,
        agentId,
        integrationId: existing?.id,
        isNewIntegration: !existing,
      });
      encryptedBotToken = this.cryptoService.encrypt(dto.botToken);
      const me = await this.telegramApiService.getMe(dto.botToken);
      botUsername = me.username ?? null;
      this.logger.log('Telegram bot token validated', {
        userId,
        agentId,
        integrationId: existing?.id,
        botUsername: me.username,
        botId: me.id,
      });
    }

    const webhookSecret = existing?.webhookSecret ?? this.generateWebhookSecret();
    const saved = existing
      ? (await this.integrationStore.update(existing.id, {
          encryptedBotToken,
          botUsername,
          enabled: dto.enabled,
          status: TelegramIntegrationStatus.PENDING,
          errorMessage: null,
        }))!
      : (await this.integrationStore.insert({
          userId,
          agentId,
          encryptedBotToken,
          botUsername,
          webhookSecret,
          enabled: dto.enabled,
          status: TelegramIntegrationStatus.PENDING,
        }))!;

    this.logger.log('Telegram integration saved, syncing webhook state', {
      userId,
      agentId,
      integrationId: saved.id,
      enabled: saved.enabled,
      botUsername: saved.botUsername,
      hasToken: !!saved.encryptedBotToken,
    });
    const response = await this.syncWebhookState(saved);
    this.logger.log('Telegram integration upsert completed', {
      userId,
      agentId,
      integrationId: saved.id,
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
    await this.integrationStore.update(integration.id, {
      status: TelegramIntegrationStatus.ACTIVE,
      errorMessage: null,
    });
  }

  async deleteForAgent(userId: string, agentId: string): Promise<void> {
    const integration = await this.getIntegrationForAgent(userId, agentId);
    await this.clearWebhook(integration);
    // Bindings + link codes cascade via validated FKs (plan 4.7).
    await this.integrationStore.delete(integration.id);
  }

  async getByIntegrationId(integrationId: string): Promise<TelegramIntegrationRow> {
    const integration = await this.integrationStore.findById(integrationId);
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
  ): Promise<TelegramIntegrationRow> {
    return this.getIntegrationForAgent(userId, agentId);
  }

  async validateWebhookSecret(
    integrationId: string,
    secretToken: string | undefined,
  ): Promise<TelegramIntegrationRow> {
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
      await this.integrationStore.touchLastWebhook(integrationId);
      return 'processed';
    }
    // Dedup: zero rows means a stale/duplicate update (plan 4.7).
    const processed = await this.integrationStore.markWebhookUpdate(integrationId, updateId);
    return processed ? 'processed' : 'duplicate';
  }

  getDecryptedToken(integration: TelegramIntegrationRow): string {
    return this.cryptoService.decrypt(integration.encryptedBotToken);
  }

  private async syncWebhookState(
    integration: TelegramIntegrationRow,
  ): Promise<TelegramIntegrationResponseDto> {
    let webhookRegistered = false;
    let messageKey: TelegramIntegrationMessageKey = 'saved';
    let linkCode: string | undefined;
    let linkCodeExpiresAt: string | undefined;
    let status = integration.status;
    let errorMessage: string | null = integration.errorMessage;

    this.logger.log('Telegram webhook sync started', {
      integrationId: integration.id,
      agentId: integration.agentId,
      enabled: integration.enabled,
      hasToken: !!integration.encryptedBotToken,
      botUsername: integration.botUsername,
    });

    if (integration.enabled && integration.encryptedBotToken) {
      try {
        const webhookUrl = await this.registerWebhook(integration);
        status = TelegramIntegrationStatus.ACTIVE;
        errorMessage = null;
        webhookRegistered = true;
        messageKey = 'webhook_success';

        this.logger.log('Telegram webhook registered successfully', {
          integrationId: integration.id,
          agentId: integration.agentId,
          webhookUrl,
          botUsername: integration.botUsername,
        });

        const linkCodeResult = await this.linkCodeService.generateForIntegration(integration);
        linkCode = linkCodeResult.code;
        linkCodeExpiresAt = linkCodeResult.expiresAt;

        this.logger.log('Telegram link code generated for chat binding', {
          integrationId: integration.id,
          agentId: integration.agentId,
          linkCode,
          expiresAt: linkCodeExpiresAt,
        });
      } catch (error) {
        status = TelegramIntegrationStatus.ERROR;
        errorMessage = (error as Error).message;
        messageKey = 'webhook_failed';
        this.logger.warn('Telegram webhook auto-registration failed during upsert', {
          integrationId: integration.id,
          agentId: integration.agentId,
          botUsername: integration.botUsername,
          error: (error as Error).message,
        });
      }
    } else if (!integration.enabled && integration.encryptedBotToken) {
      this.logger.log('Telegram integration disabled, clearing webhook', {
        integrationId: integration.id,
        agentId: integration.agentId,
      });
      await this.clearWebhook(integration);
      status = TelegramIntegrationStatus.PENDING;
      errorMessage = null;
      messageKey = 'disabled';
    } else {
      this.logger.log('Telegram webhook sync skipped', {
        integrationId: integration.id,
        agentId: integration.agentId,
        enabled: integration.enabled,
        hasToken: !!integration.encryptedBotToken,
        reason: !integration.enabled ? 'integration_disabled' : 'no_bot_token',
      });
    }

    const updated = await this.integrationStore.update(integration.id, { status, errorMessage });

    return this.toResponse(updated ?? integration, {
      webhookRegistered,
      messageKey,
      linkCode,
      linkCodeExpiresAt,
    });
  }

  private async registerWebhook(integration: TelegramIntegrationRow): Promise<string> {
    const botToken = this.cryptoService.decrypt(integration.encryptedBotToken);
    const backendUrl = stripTrailingChar(this.configService.get<string>('app.backendUrl', ''), '/');
    if (!backendUrl) {
      this.logger.warn('Telegram webhook registration blocked: BACKEND_URL missing', {
        integrationId: integration.id,
        agentId: integration.agentId,
      });
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'BACKEND_URL must be configured to register Telegram webhook',
      );
    }
    const webhookPath = `/api/v1/integrations/telegram/webhook/${integration.id}`;
    const webhookUrl = `${backendUrl}${webhookPath}`;

    this.logger.log('Registering Telegram webhook with Telegram API', {
      integrationId: integration.id,
      agentId: integration.agentId,
      webhookUrl,
      botUsername: integration.botUsername,
      hasWebhookSecret: !!integration.webhookSecret,
    });

    await this.telegramApiService.setWebhook(botToken, webhookUrl, integration.webhookSecret);
    return webhookUrl;
  }

  private async clearWebhook(integration: TelegramIntegrationRow): Promise<void> {
    if (!integration.encryptedBotToken) {
      return;
    }
    try {
      this.logger.log('Deleting Telegram webhook via Telegram API', {
        integrationId: integration.id,
        agentId: integration.agentId,
        botUsername: integration.botUsername,
      });
      const token = this.cryptoService.decrypt(integration.encryptedBotToken);
      await this.telegramApiService.deleteWebhook(token);
      this.logger.log('Telegram webhook deleted', {
        integrationId: integration.id,
        agentId: integration.agentId,
      });
    } catch (error) {
      this.logger.warn('Failed to delete Telegram webhook', {
        integrationId: integration.id,
        agentId: integration.agentId,
        error: (error as Error).message,
      });
    }
  }

  private async getIntegrationForAgent(
    userId: string,
    agentId: string,
  ): Promise<TelegramIntegrationRow> {
    await this.assertAgentOwnership(userId, agentId);
    const integration = await this.integrationStore.findByAgent(agentId);
    if (!integration) {
      throw new NotFoundException(
        ErrorCode.TELEGRAM_INTEGRATION_NOT_FOUND,
        'Telegram integration not found for this agent',
      );
    }
    return integration;
  }

  private async assertAgentOwnership(userId: string, agentId: string): Promise<void> {
    if (!isObjectId(agentId)) {
      throw new NotFoundException(
        ErrorCode.TELEGRAM_INTEGRATION_NOT_FOUND,
        'Telegram integration not found for this agent',
      );
    }
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
      botUsername?: string | null;
      status?: string;
      errorMessage?: string | null;
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
      botUsername: integration.botUsername ?? undefined,
      status: integration.status as TelegramIntegrationResponseDto['status'],
      errorMessage: integration.errorMessage ?? undefined,
      updatedAt: integration.updatedAt?.toISOString(),
      webhookRegistered: extras?.webhookRegistered,
      messageKey: extras?.messageKey,
      linkCode: extras?.linkCode,
      linkCodeExpiresAt: extras?.linkCodeExpiresAt,
    };
  }

  private generateWebhookSecret(): string {
    return `${randomUUID().replaceAll('-', '')}${randomBytes(8).toString('hex')}`;
  }
}
