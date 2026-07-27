import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_STREAM_TITLE_MAX, WORKY_STREAM_TITLE_MIN } from '../constants/worky.constants';

export class UpdateWorkyStreamDto {
  @ApiPropertyOptional({ description: 'Stream title', minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(WORKY_STREAM_TITLE_MIN)
  @MaxLength(WORKY_STREAM_TITLE_MAX)
  title?: string;

  /**
   * Per-stream manager model selection. LiteLLM model identifier
   * (e.g. `gpt-4o-mini`). Omit = no change; explicit `null` = clear
   * the persistent override so the runtime falls back to the admin
   * default.
   */
  @ApiPropertyOptional({
    description:
      'LiteLLM model identifier for the Manager agent. Pass null to clear and fall back to the admin default.',
    maxLength: 256,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(256)
  managerModelId?: string | null;

  /**
   * Per-stream worker model selection. Same semantics as
   * `managerModelId`. Used for ephemeral workers spawned on the
   * ready tasks of this stream.
   */
  @ApiPropertyOptional({
    description:
      'LiteLLM model identifier for ephemeral workers. Pass null to clear and fall back to the admin default.',
    maxLength: 256,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(256)
  workerModelId?: string | null;

  /**
   * LiteLLM model identifier for the Planner. Sent to the orchestrator as
   * `planner_model`. Pass null to clear and fall back to the admin default.
   */
  @ApiPropertyOptional({
    description:
      'LiteLLM model identifier for the Planner. Pass null to clear and fall back to the admin default.',
    maxLength: 256,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(256)
  plannerModelId?: string | null;

  /**
   * LiteLLM model identifier for Executors. Sent to the orchestrator as
   * `executor_model`. Pass null to clear and fall back to the admin default.
   */
  @ApiPropertyOptional({
    description:
      'LiteLLM model identifier for Executors. Pass null to clear and fall back to the admin default.',
    maxLength: 256,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(256)
  executorModelId?: string | null;

  /**
   * System-prompt override for the Planner. Sent as `planner_prompt`. Pass
   * null/empty to use the server default.
   */
  @ApiPropertyOptional({
    description:
      'System prompt override for the Planner. Pass null/empty to use the server default.',
    maxLength: 40000,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(40000)
  plannerPrompt?: string | null;

  /**
   * System-prompt override for Executors. Sent as `executor_prompt`. Pass
   * null/empty to use the server default.
   */
  @ApiPropertyOptional({
    description:
      'System prompt override for Executors. Pass null/empty to use the server default.',
    maxLength: 40000,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(40000)
  executorPrompt?: string | null;
}
