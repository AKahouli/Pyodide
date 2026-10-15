import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateConversationImageDto {
  @ApiProperty() @IsMongoId() conversationId!: string;
  @ApiProperty() @IsMongoId() userId!: string;
  @ApiProperty() @IsMongoId() agentId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) model!: string;
  @ApiPropertyOptional() @ValidateIf(value => !value.reuseImage) @IsString() @MinLength(1) @MaxLength(12000) prompt!: string;
  @ApiPropertyOptional({ description: 'Generated image reference, exact accessible filename, or public HTTPS image URL to edit' })
  @IsOptional() @IsString() @MaxLength(8192) @Matches(/^(?:generated-image:[a-f0-9]{24}|https:\/\/[^\s\x00-\x1f\x7f]+|[^/\\\r\n:]+\.(?:png|jpe?g|webp|pdf))$/i)
  sourceImage?: string;
  @ApiPropertyOptional({ description: 'Image reference, exact accessible filename, or public HTTPS image URL to reuse without generation' })
  @IsOptional() @IsString() @MaxLength(8192) @Matches(/^(?:generated-image:[a-f0-9]{24}|https:\/\/[^\s\x00-\x1f\x7f]+|[^/\\\r\n:]+\.(?:png|jpe?g|webp|pdf))$/i)
  reuseImage?: string;
  @ApiPropertyOptional({ description: 'One-based PDF page to render', minimum: 1, maximum: 5000 })
  @IsOptional() @IsInt() @Min(1) @Max(5000) sourcePage?: number;
  @ApiPropertyOptional({ description: 'Internal runtime-only prepared PDF page PNG' })
  @IsOptional() @IsString() @MaxLength(8 * 1024 * 1024) preparedImage?: string;
  @ApiProperty({ enum: ['square', 'landscape', 'portrait'] })
  @IsIn(['square', 'landscape', 'portrait']) aspectRatio!: 'square' | 'landscape' | 'portrait';
}
