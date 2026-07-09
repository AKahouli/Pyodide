import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsObject, IsOptional } from 'class-validator';

export class CreateGovernanceRevisionDto {
  @ApiProperty()
  @IsMongoId()
  agentId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workspaceIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  sourceIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  includedSourceIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  excludedSourceIds?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  agentSnapshot?: Record<string, unknown>;
}
