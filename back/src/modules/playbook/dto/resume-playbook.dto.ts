import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsIn } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Stable interrupt instance identifier for stale-tab protection' })
  @IsString()
  @IsOptional()
  interruptId?: string;

  @ApiPropertyOptional({ description: 'Conversational HITL action', enum: ['reply', 'approve', 'reject', 'skip'] })
  @IsString()
  @IsOptional()
  @IsIn(['reply', 'approve', 'reject', 'skip'])
  action?: 'reply' | 'approve' | 'reject' | 'skip';

  @ApiPropertyOptional({ description: 'Conversational HITL reply message' })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({ description: 'Legacy approval flag for binary interrupts' })
  @IsBoolean()
  @IsOptional()
  approved?: boolean;

  @ApiPropertyOptional({ description: 'Legacy reason for rejection' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Legacy clarification or review feedback' })
  @IsString()
  @IsOptional()
  feedback?: string;
}
