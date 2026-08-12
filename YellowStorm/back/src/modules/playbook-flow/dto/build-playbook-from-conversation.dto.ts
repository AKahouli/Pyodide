import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class BuildPlaybookFromConversationDto {
  @ApiProperty({ description: 'Conversation containing the selected response' })
  @IsMongoId()
  conversationId!: string;

  @ApiProperty({ description: 'Completed AI response used to build the playbook' })
  @IsMongoId()
  assistantMessageId!: string;

  @ApiProperty({ description: 'Displayed persisted answer version', example: 'original' })
  @IsString()
  @Matches(/^(original|corrected|abstention|attempt:[A-Za-z0-9_-]{1,128})$/)
  answerVersion!: string;

  @ApiProperty({ description: 'Optional user-provided playbook name', required: false, minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
}
