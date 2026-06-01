import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type TelegramIntegrationMessageKey =
  | 'webhook_success'
  | 'webhook_failed'
  | 'disabled'
  | 'saved';

export class TelegramIntegrationResponseDto {
  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: true })
  hasToken!: boolean;

  @ApiPropertyOptional({ enum: ['pending', 'active', 'error'], example: 'active' })
  status?: 'pending' | 'active' | 'error';

  @ApiPropertyOptional({ example: 'Invalid webhook configuration' })
  errorMessage?: string;

  @ApiPropertyOptional({ example: '2026-05-25T16:12:00.000Z' })
  updatedAt?: string;

  @ApiPropertyOptional({ example: 'my_agent_bot' })
  botUsername?: string;

  @ApiPropertyOptional({ example: true })
  webhookRegistered?: boolean;

  @ApiPropertyOptional({
    enum: ['webhook_success', 'webhook_failed', 'disabled', 'saved'],
    example: 'webhook_success',
  })
  messageKey?: TelegramIntegrationMessageKey;

  @ApiPropertyOptional({ example: 'AB12CD34' })
  linkCode?: string;

  @ApiPropertyOptional({ example: '2026-05-25T16:27:00.000Z' })
  linkCodeExpiresAt?: string;
}

export class TelegramLinkCodeResponseDto {
  @ApiProperty({ example: 'AB12CD34' })
  code!: string;

  @ApiProperty({ example: '2026-05-25T16:27:00.000Z' })
  expiresAt!: string;
}
