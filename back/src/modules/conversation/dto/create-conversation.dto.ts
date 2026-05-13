import { IsOptional, IsString, MaxLength, IsArray, IsMongoId, IsEmail, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ParticipantDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  job?: string;
}

export class CreateConversationDto {
  @ApiPropertyOptional({ maxLength: 200, default: 'New Conversation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Workspace IDs to attach', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workspaces?: string[];

  @ApiPropertyOptional({ description: 'Participant emails for group chat', type: [String] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  participantEmails?: string[];

  @ApiPropertyOptional({ description: 'Participants for group chat', type: [ParticipantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants?: ParticipantDto[];

  @ApiPropertyOptional({ description: 'Owner role/job for group chat', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownerJob?: string;
}
