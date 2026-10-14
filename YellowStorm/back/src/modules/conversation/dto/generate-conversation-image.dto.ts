import { IsIn, IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateConversationImageDto {
  @ApiProperty() @IsMongoId() conversationId!: string;
  @ApiProperty() @IsMongoId() userId!: string;
  @ApiProperty() @IsMongoId() agentId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) model!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(12000) prompt!: string;
  @ApiProperty({ enum: ['square', 'landscape', 'portrait'] })
  @IsIn(['square', 'landscape', 'portrait']) aspectRatio!: 'square' | 'landscape' | 'portrait';
}
