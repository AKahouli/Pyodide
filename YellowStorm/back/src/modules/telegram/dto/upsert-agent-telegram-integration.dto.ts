import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpsertAgentTelegramIntegrationDto {
  @ApiProperty({
    description: 'Whether Telegram integration is enabled for this agent',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description:
      'Telegram bot token. Optional for updates when keeping an already stored token.',
    required: false,
    example: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, {
    message: 'Bot token must match Telegram token format',
  })
  botToken?: string;
}
