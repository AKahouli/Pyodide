import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGovernanceDryRunDto {
  @ApiPropertyOptional({ enum: ['widget', 'whatsapp', 'telegram', 'api'] })
  @IsOptional()
  @IsIn(['widget', 'whatsapp', 'telegram', 'api'])
  simulatedChannel?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  input?: string;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  testCases?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  checks?: Record<string, unknown>;
}
