import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SyncPlaybookMailSubscriptionDto {
  @ApiPropertyOptional({ example: 'https://example.com/api/v1/playbooks/mail/webhook' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notificationUrl?: string;
}
