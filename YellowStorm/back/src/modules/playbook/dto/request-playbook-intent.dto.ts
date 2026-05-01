import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestPlaybookIntentDto {
  @ApiProperty({ description: 'Raw user intent entered from the canvas assistant bar.' })
  @IsString()
  @MaxLength(4000)
  intent!: string;

  @ApiPropertyOptional({ description: 'Selected task id when the assistant is focused on an existing node.' })
  @IsOptional()
  @IsString()
  selectedTaskId?: string;
}
