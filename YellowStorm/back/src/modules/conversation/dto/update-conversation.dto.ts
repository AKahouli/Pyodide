import { IsOptional, IsString, MaxLength, IsBoolean, IsArray, IsMongoId, IsEmail, ValidateNested, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateParticipantDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  job?: string;
}

export class UpdateConversationDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({ description: 'Workspace IDs to attach', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workspaces?: string[];

  @ApiPropertyOptional({ description: 'Emails of participants to invite', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantEmails?: string[];

  @ApiPropertyOptional({ description: 'Participants to invite for group chat', type: [UpdateParticipantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateParticipantDto)
  participants?: UpdateParticipantDto[];

  @ApiPropertyOptional({ description: 'IDs of agents tagged in the conversation', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  taggedAgents?: string[];

  @ApiPropertyOptional({ description: 'Project ID to move this conversation into (or null to remove from any project)', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsMongoId()
  projectId?: string | null;
}
