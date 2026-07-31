import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsObject, IsUUID } from 'class-validator';

export class BranchConversationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ description: 'Completed AI message through which to branch' })
  @IsMongoId()
  targetMessageId!: string;

  @ApiProperty({
    description: 'Selected AI response by user message ID',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  activeBranches!: Record<string, string>;
}
