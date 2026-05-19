import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateAdminPlaybookSettingsDto {
  @ApiPropertyOptional({ description: 'Model registry ID to use for playbook inference. Null inherits the global default model.' })
  @IsOptional()
  @IsString()
  inferenceModelId?: string | null;

  @ApiPropertyOptional({ description: 'Model registry ID to use for Advisor evaluation. Null inherits the global default model.' })
  @IsOptional()
  @IsString()
  advisorEvaluationModelId?: string | null;

  @ApiProperty({ enum: ['auto', 'manual'], default: 'manual' })
  @IsIn(['auto', 'manual'])
  nodeSuggestionsMode!: 'auto' | 'manual';

  @ApiProperty({ enum: ['auto', 'manual'], default: 'auto' })
  @IsIn(['auto', 'manual'])
  approvalSuggestionMode!: 'auto' | 'manual';
}

export class UpdatePlaybookDesignSettingsDto {
  @ApiPropertyOptional({ description: 'Per-playbook model override. Null inherits the admin playbook model.' })
  @IsOptional()
  @IsString()
  inferenceModelId?: string | null;

  @ApiPropertyOptional({ enum: ['inherit', 'auto', 'manual'], default: 'inherit' })
  @IsOptional()
  @IsIn(['inherit', 'auto', 'manual'])
  nodeSuggestionsMode?: 'inherit' | 'auto' | 'manual';

  @ApiPropertyOptional({ enum: ['inherit', 'auto', 'manual'], default: 'inherit' })
  @IsOptional()
  @IsIn(['inherit', 'auto', 'manual'])
  approvalSuggestionMode?: 'inherit' | 'auto' | 'manual';
}
