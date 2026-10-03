import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { ROOT_POLICY_CEILINGS } from '../interfaces/root-execution-policy.interface';

export class RootDelegationDto {
  @ApiProperty({ description: 'Whether the root may delegate to its allowlist', default: true })
  @IsBoolean()
  enabled = true;

  @ApiProperty({
    description: 'Capability mode applied to delegates without an override',
    enum: ['native', 'root_constrained'],
    default: 'native',
  })
  @IsIn(['native', 'root_constrained'])
  defaultConfigurationMode: 'native' | 'root_constrained' = 'native';
}

export class RootTemporaryWorkersDto {
  @ApiProperty({ description: 'Runtime-only workers enabled (no child delegation)', default: true })
  @IsBoolean()
  enabled = true;

  @ApiProperty({ description: 'Max temporary workers per work group' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ROOT_POLICY_CEILINGS.maxTemporaryWorkersPerWorkGroup)
  maxPerWorkGroup = 4;
}

export class RootFanoutDto {
  @ApiProperty({ description: 'Deterministic fan-out enabled', default: false })
  @IsBoolean()
  enabled = false;

  @ApiProperty({ description: 'Max items per manifest' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROOT_POLICY_CEILINGS.maxFanoutItems)
  maxItems = 20;

  @ApiProperty({ description: 'Background fan-out permitted', default: false })
  @IsBoolean()
  allowBackground = false;
}

export class RootBackgroundDto {
  @ApiProperty({ description: 'Durable background tasks enabled', default: false })
  @IsBoolean()
  enabled = false;

  @ApiProperty({ description: 'Max outstanding background jobs per conversation' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROOT_POLICY_CEILINGS.maxOutstandingBackgroundJobs)
  maxOutstandingPerConversation = 2;

  @ApiProperty({ description: 'Background task timeout in seconds' })
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(ROOT_POLICY_CEILINGS.maxBackgroundTaskTimeoutSeconds)
  taskTimeoutSeconds = 900;

  @ApiProperty({ description: 'Max safe attempts per background job' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROOT_POLICY_CEILINGS.maxBackgroundAttempts)
  maxAttempts = 3;
}

export class RootLimitsDto {
  @ApiProperty({ description: 'Delegation depth is fixed at 1', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  maxDepth = 1 as const;

  @ApiProperty({ description: 'Max simultaneous leaf workers' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROOT_POLICY_CEILINGS.maxParallelWorkers)
  maxParallelWorkers = 2;

  @ApiProperty({ description: 'Total child executions per work group' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROOT_POLICY_CEILINGS.maxChildExecutionsPerWorkGroup)
  maxChildExecutionsPerWorkGroup = 32;

  @ApiProperty({ description: 'Work-group deadline in seconds' })
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(ROOT_POLICY_CEILINGS.maxWorkGroupDurationSeconds)
  maxWorkGroupDurationSeconds = 1800;
}

export class RootDelegateModeOverrideDto {
  @ApiProperty({ description: 'Delegate agent id (24-char hex)' })
  @IsString()
  @Matches(/^[0-9a-fA-F]{24}$/)
  agentId!: string;

  @ApiProperty({ enum: ['native', 'root_constrained'] })
  @IsIn(['native', 'root_constrained'])
  configurationMode!: 'native' | 'root_constrained';
}

export class RootExecutionPolicyDto {
  @ApiProperty({ description: 'Policy schema version', default: 1 })
  @Type(() => Number)
  @IsInt()
  @IsIn([1])
  version = 1 as const;

  @ApiProperty({ type: RootDelegationDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RootDelegationDto)
  delegation?: RootDelegationDto;

  @ApiProperty({ type: RootTemporaryWorkersDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RootTemporaryWorkersDto)
  temporaryWorkers?: RootTemporaryWorkersDto;

  @ApiProperty({ type: RootFanoutDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RootFanoutDto)
  fanout?: RootFanoutDto;

  @ApiProperty({ type: RootBackgroundDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RootBackgroundDto)
  background?: RootBackgroundDto;

  @ApiProperty({ type: RootLimitsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RootLimitsDto)
  limits?: RootLimitsDto;

  @ApiPropertyOptional({ type: [RootDelegateModeOverrideDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RootDelegateModeOverrideDto)
  perAgentModeOverrides?: RootDelegateModeOverrideDto[];
}

