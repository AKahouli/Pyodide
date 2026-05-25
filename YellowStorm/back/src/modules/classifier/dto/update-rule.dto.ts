import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRuleDto {
  @ApiPropertyOptional({ description: 'Updated rule text', minLength: 1, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({ description: 'Updated enabled state' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
