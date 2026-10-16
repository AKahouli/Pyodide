import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** 64 KiB, matching the MCP code bound. */
const MAX_CODE_LENGTH = 64 * 1024;

/** Bare filename: no path separators, no traversal. */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,254}$/;

export class ExecutePyodideDto {
  @ApiProperty({ description: 'Python code to execute in the user browser.' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiPropertyOptional({ description: 'Optional JSON-compatible input exposed as input_data.' })
  @IsOptional()
  @Allow()
  input?: unknown;

  @ApiPropertyOptional({ description: 'Execution timeout in milliseconds.', default: 30_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90_000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    description: 'Exact workspace file names to mount read-only under /workspace/input.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(FILE_NAME_PATTERN, { each: true })
  inputs?: string[];

  @ApiPropertyOptional({ description: 'File names written under /workspace/output to persist.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(FILE_NAME_PATTERN, { each: true })
  outputs?: string[];
}
