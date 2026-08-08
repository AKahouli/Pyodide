import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ApprovalDecision = 'approved' | 'rejected';

const APPROVAL_DECISION_ALIASES: Record<string, ApprovalDecision> = {
  approve: 'approved',
  approved: 'approved',
  reject: 'rejected',
  rejected: 'rejected',
};

export function normalizeApprovalDecision(value: unknown): ApprovalDecision | unknown {
  if (typeof value !== 'string') return value;
  return APPROVAL_DECISION_ALIASES[value.trim().toLowerCase()] ?? value;
}

export class ResumePlaybookFlowApprovalDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @Transform(({ value }) => normalizeApprovalDecision(value))
  @IsIn(['approved', 'rejected'])
  decision!: ApprovalDecision;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
