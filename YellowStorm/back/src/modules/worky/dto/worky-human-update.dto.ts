import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Human Kanban update kinds. Each kind emits a corresponding SSE event
 * (canonical §14.4) and the readiness evaluator picks it up to resume
 * the dependent DAG branch. Only valid for tasks with
 * `assigneeType === 'human_agent'`.
 */
export type WorkyHumanUpdateKind =
  | 'in_progress'
  | 'feedback'
  | 'request_changes'
  | 'blocked'
  | 'done';

export const WORKY_HUMAN_UPDATE_KINDS: readonly WorkyHumanUpdateKind[] = [
  'in_progress',
  'feedback',
  'request_changes',
  'blocked',
  'done',
];

export class WorkyHumanUpdateDto {
  @IsIn(WORKY_HUMAN_UPDATE_KINDS as readonly string[])
  kind!: WorkyHumanUpdateKind;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;
}
