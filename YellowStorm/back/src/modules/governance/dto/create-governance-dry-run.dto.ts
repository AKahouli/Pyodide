import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGovernanceDryRunDto {
  @ApiPropertyOptional({ enum: ['widget', 'whatsapp', 'telegram', 'api'] })
  @IsOptional()
  @IsIn(['widget', 'whatsapp', 'telegram', 'api'])
  simulatedChannel?: string;

  @ApiPropertyOptional({ description: 'Continue an existing dry-run conversation instead of starting a new one' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Which mapped agent to test. Defaults to the draft revision primary agent.' })
  @IsOptional()
  @IsString()
  agentId?: string;

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
