import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class SyncPlaybookMailSubscriptionDto {
  @ApiPropertyOptional({ example: 'https://example.com/api/v1/playbooks/mail/webhook' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notificationUrl?: string;

  @ApiPropertyOptional({
    example: '2026-05-01T00:00:00.000Z',
    description: 'Stop auto-renewing the Microsoft 365 subscription after this UTC timestamp.',
  })
  @IsOptional()
  @IsDateString()
  autoRenewUntil?: string;
}
