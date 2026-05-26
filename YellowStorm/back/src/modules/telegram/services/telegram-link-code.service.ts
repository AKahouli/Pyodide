import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { BadRequestException } from '@modules/exceptions';
import { TelegramLinkCode, TelegramLinkCodeDocument } from '../schemas/telegram-link-code.schema';
import { AgentTelegramIntegrationDocument } from '../schemas/agent-telegram-integration.schema';
import { TelegramLinkCodeResponseDto } from '../dto/telegram-integration-response.dto';

@Injectable()
export class TelegramLinkCodeService {
  constructor(
    @InjectModel(TelegramLinkCode.name)
    private readonly linkCodeModel: Model<TelegramLinkCodeDocument>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TelegramLinkCodeService.name);
  }

  async generateForIntegration(
    integration: AgentTelegramIntegrationDocument,
  ): Promise<TelegramLinkCodeResponseDto> {
    const ttlSeconds = this.configService.get<number>('telegram.linkCodeTtlSeconds', 900);
    const length = this.configService.get<number>('telegram.linkCodeLength', 8);
    const code = this.generateCode(length);
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.linkCodeModel.deleteMany({
      integrationId: integration._id,
      consumed: false,
    });

    await this.linkCodeModel.create({
      integrationId: integration._id,
      userId: integration.userId,
      agentId: integration.agentId,
      codeHash,
      expiresAt,
      consumed: false,
    });

    return {
      code,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async consumeCodeOrThrow(
    code: string,
    integrationId: Types.ObjectId,
  ): Promise<TelegramLinkCodeDocument> {
    const codeHash = this.hashCode(code);
    const now = new Date();
    const record = await this.linkCodeModel.findOneAndUpdate(
      {
        codeHash,
        integrationId,
        consumed: false,
        expiresAt: { $gt: now },
      },
      {
        $set: { consumed: true, consumedAt: now },
      },
      { new: true },
    );

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
