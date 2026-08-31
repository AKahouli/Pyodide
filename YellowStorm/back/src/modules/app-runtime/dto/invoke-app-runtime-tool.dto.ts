import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class InvokeAppRuntimeToolDto {
  @ApiProperty({ description: 'Workspace to dispatch to (Conversation V2 session id).' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  workspaceId!: string;

  @ApiProperty({ description: 'Idempotency key. The same id never mutates twice.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  toolCallId!: string;

  @ApiProperty({ description: 'Runtime MCP tool name, e.g. "read" or "apply_patch".' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  tool!: string;

  @ApiPropertyOptional({ description: 'Tool arguments, forwarded to the browser as-is.' })
  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Revision the caller assumes. A mismatch triggers rehydration.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  baseRevisionId?: string;

  @ApiPropertyOptional({ description: 'Overrides the default tool timeout.' })
  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(600_000)
  timeoutMs?: number;
}
