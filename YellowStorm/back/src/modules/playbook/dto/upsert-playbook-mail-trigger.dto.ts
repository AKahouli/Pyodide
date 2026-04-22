import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlaybookMailTriggerFiltersDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  from?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  subjectContains?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  bodyContains?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasAttachments?: boolean;
}

export class UpsertPlaybookMailTriggerDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    example: 'microsoft',
    description: 'Connected app key backing the mailbox capability. Required when enabled is true.',
  })
  @ValidateIf((o: UpsertPlaybookMailTriggerDto) => o.enabled === true)
  @IsString()
  @MaxLength(64)
  mailboxAppKey?: string;

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

  @ApiPropertyOptional({ description: 'Whether matching email attachments should be imported into the playbook workspace.' })
  @IsOptional()
  @IsBoolean()
  attachmentImportEnabled?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Allowed attachment extensions, without dots.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  allowedAttachmentExtensions?: string[];

  @ApiPropertyOptional({ type: PlaybookMailTriggerFiltersDto })
  @ValidateIf((o: UpsertPlaybookMailTriggerDto) => o.enabled === true)
  @ValidateNested()
  @Type(() => PlaybookMailTriggerFiltersDto)
  filters?: PlaybookMailTriggerFiltersDto;
}
