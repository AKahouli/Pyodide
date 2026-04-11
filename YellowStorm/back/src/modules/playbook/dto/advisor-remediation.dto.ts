import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetAdvisorRemediationsDto {
  @ApiPropertyOptional({ description: 'Limit to a specific task' })
  @IsOptional()
  @IsString()
  taskId?: string;
}

export class ApplyAdvisorRemediationsDto {
  @ApiPropertyOptional({ description: 'Mode of application' })
  @IsOptional()
  @IsString()
  @IsIn(['update-current', 'generate-new'])
  mode?: string;

  @ApiPropertyOptional({ description: 'Selected remediation item IDs to apply' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedIds?: string[];
}
