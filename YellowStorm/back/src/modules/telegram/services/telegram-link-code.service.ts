import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { BadRequestException } from '@modules/exceptions';
import { TELEGRAM_LINK_CODE_STORE, type TelegramIntegrationRow, type TelegramLinkCodeRow, type TelegramLinkCodeStore } from '../persistence/telegram.store';
import { TelegramLinkCodeResponseDto } from '../dto/telegram-integration-response.dto';

@Injectable()
export class TelegramLinkCodeService {
  constructor(
    @Inject(TELEGRAM_LINK_CODE_STORE)
    private readonly linkCodeStore: TelegramLinkCodeStore,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TelegramLinkCodeService.name);
  }

  async generateForIntegration(
    integration: TelegramIntegrationRow,
  ): Promise<TelegramLinkCodeResponseDto> {
    const ttlSeconds = this.configService.get<number>('telegram.linkCodeTtlSeconds', 900);
    const length = this.configService.get<number>('telegram.linkCodeLength', 8);
    const code = this.generateCode(length);
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // withTransaction { DELETE unconsumed; INSERT } (plan 4.7).
    await this.linkCodeStore.generate({
      integrationId: integration.id,
      userId: integration.userId,
      agentId: integration.agentId,
      codeHash,
      expiresAt,
    });

    return {
      code,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async consumeCodeOrThrow(
    code: string,
    integrationId: string,
  ): Promise<TelegramLinkCodeRow> {
    const codeHash = this.hashCode(code);
    // Conditional UPDATE ... RETURNING (plan 4.7).
    const record = await this.linkCodeStore.consume(codeHash, integrationId);

    if (!record) {
      throw new BadRequestException(
        ErrorCode.TELEGRAM_LINK_CODE_INVALID,
        'Telegram link code is invalid or expired',
      );
    }

    return record;
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private generateCode(length: number): string {
    const bytes = randomBytes(Math.max(length, 6));
    return bytes
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, length)
      .toUpperCase();
  }
}
