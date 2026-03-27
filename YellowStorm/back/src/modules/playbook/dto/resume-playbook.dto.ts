import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResumePlaybookDto {
  @ApiProperty({ description: 'The execution ID to resume' })
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @ApiProperty({ description: 'The task ID that was interrupted' })
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @ApiProperty({ description: 'Whether the human approved the step' })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({ description: 'Reason for rejection' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Clarification or review feedback' })
  @IsString()
  @IsOptional()
  feedback?: string;
}
