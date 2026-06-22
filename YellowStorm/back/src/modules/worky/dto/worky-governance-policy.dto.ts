import { IsArray, IsBoolean, IsIn, IsString, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_GOVERNANCE_LEVELS } from '../constants/worky.constants';

export class WorkyGovernanceCategoryRuleDto {
  @ApiProperty({ description: 'Action category (e.g. external_send)' })
  @IsString()
  @MaxLength(100)
  category!: string;

  @ApiProperty({ enum: WORKY_GOVERNANCE_LEVELS })
  @IsIn(WORKY_GOVERNANCE_LEVELS as unknown as string[])
  level!: string;
}

export class UpsertWorkyGovernancePolicyDto {
  @ApiProperty({ description: 'Workspace this policy applies to' })
  @IsString()
  workspaceId!: string;

  @ApiProperty({ enum: WORKY_GOVERNANCE_LEVELS })
  @IsIn(WORKY_GOVERNANCE_LEVELS as unknown as string[])
  defaultLevel!: string;

  @ApiProperty({ type: [WorkyGovernanceCategoryRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkyGovernanceCategoryRuleDto)
  categories!: WorkyGovernanceCategoryRuleDto[];

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  allowStreamOwnerOverride?: boolean;

  @ApiPropertyOptional({ enum: WORKY_GOVERNANCE_LEVELS, default: 'notify' })
  @IsIn(WORKY_GOVERNANCE_LEVELS as unknown as string[])
  maxOwnerRelaxLevel?: string;
}
