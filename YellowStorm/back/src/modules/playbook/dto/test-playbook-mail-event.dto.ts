import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class TestMailParticipantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  address!: string;
}

export class TestPlaybookMailEventDto {
  @ApiProperty({ example: 'microsoft' })
  @IsString()
  @MaxLength(64)
  mailboxAppKey!: string;

  @ApiProperty({ example: 'msg-123' })
  @IsString()
  @MaxLength(200)
  providerMessageId!: string;

  @ApiPropertyOptional({ example: 'thread-1' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerThreadId?: string;

  @ApiProperty({ example: '2026-04-17T12:00:00Z' })
  @IsISO8601()
  receivedAt!: string;

  @ApiProperty({ example: '2026-04-17T12:00:00Z' })
  @IsISO8601()
  occurredAt!: string;

  @ApiPropertyOptional({ example: 'Urgent invoice' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @ApiPropertyOptional({ example: 'Please review this invoice today' })
  @IsOptional()
  @IsString()
  bodyText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @ApiProperty({ type: TestMailParticipantDto })
  @ValidateNested()
  @Type(() => TestMailParticipantDto)
  from!: TestMailParticipantDto;

  @ApiPropertyOptional({ type: [TestMailParticipantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestMailParticipantDto)
  to?: TestMailParticipantDto[];

  @ApiPropertyOptional({ type: [TestMailParticipantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestMailParticipantDto)
  cc?: TestMailParticipantDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasAttachments?: boolean;
}
