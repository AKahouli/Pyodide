import { IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateConversationImageDto {
  @ApiProperty() @IsMongoId() conversationId!: string;
  @ApiProperty() @IsMongoId() userId!: string;
  @ApiProperty() @IsMongoId() agentId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) model!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(12000) prompt!: string;
  @ApiPropertyOptional({ description: 'Existing generated image in this conversation to edit' })
  @IsOptional() @IsString() @Matches(/^generated-image:[a-f0-9]{24}$/)
  sourceImage?: string;
  @ApiProperty({ enum: ['square', 'landscape', 'portrait'] })
  @IsIn(['square', 'landscape', 'portrait']) aspectRatio!: 'square' | 'landscape' | 'portrait';
}
