import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
export class ConversationAssetQueryDto {
  @IsOptional() @IsString() @MaxLength(2048) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(['image', 'file', 'app']) kind?: 'image' | 'file' | 'app';
}
export class ReadConversationAssetDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30000) maxChars?: number;
}
export class InternalConversationAssetDto extends ConversationAssetQueryDto {
  @IsMongoId() userId!: string;
  @IsMongoId() conversationId!: string;
  @IsOptional() @IsString() @MaxLength(2048) ref?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30000) maxChars?: number;
}
export class PrepareConversationAssetDto {
  @IsMongoId() userId!: string;
  @IsMongoId() conversationId!: string;
  @IsString() @MaxLength(2048) ref!: string;
  @IsString() @MaxLength(200) @Matches(/^[a-zA-Z0-9_-]+$/) invocationId!: string;
  @IsOptional() @IsBoolean() includeBytes?: boolean;
}
export class RegisterConversationAssetDto {
  @IsMongoId() userId!: string;
  @IsMongoId() conversationId!: string;
  @IsString() @MaxLength(200) @Matches(/^[a-zA-Z0-9_-]+$/) invocationId!: string;
  @IsString() @MaxLength(2048) sourcePath!: string;
  @IsString() @MaxLength(200) @Matches(/^[^/\\\x00-\x1f\x7f]+$/) fileName!: string;
  @IsString() @MaxLength(150) @Matches(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/) mimeType!: string;
}
export interface ConversationAsset {
  ref: string; origin: 'upload' | 'generated' | 'workspace'; kind: 'image' | 'file' | 'app';
  name: string; mimeType?: string; size?: number; status: string;
  documentId?: string; workspaceId?: string; messageId?: string; componentId?: string; version?: string;
  actions: { view: boolean; download: boolean; read: boolean };
}
