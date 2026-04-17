import {
  IsArray,
  IsBoolean,
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

  @ApiPropertyOptional({ type: PlaybookMailTriggerFiltersDto })
  @ValidateIf((o: UpsertPlaybookMailTriggerDto) => o.enabled === true)
  @ValidateNested()
  @Type(() => PlaybookMailTriggerFiltersDto)
  filters?: PlaybookMailTriggerFiltersDto;
}
