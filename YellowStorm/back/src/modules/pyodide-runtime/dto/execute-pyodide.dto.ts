import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** 64 KiB, matching the MCP code bound. */
const MAX_CODE_LENGTH = 64 * 1024;

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
}
