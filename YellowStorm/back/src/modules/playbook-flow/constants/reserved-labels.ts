export const RESERVED_LABELS = ['__error__', '__cancelled__'] as const;

export type ReservedLabel = (typeof RESERVED_LABELS)[number];

export const CONTROL_EDGE_KINDS = ['sequential', 'conditional'] as const;

export type ControlEdgeKind = (typeof CONTROL_EDGE_KINDS)[number];

export const DATA_BINDING_SOURCE_KINDS = [
  'node-output',
  'trigger',
  'state',
  'constant',
  'expression',
] as const;

export type DataBindingSourceKind = (typeof DATA_BINDING_SOURCE_KINDS)[number];

export const EXECUTION_STATUSES = [
  'queued',
  'running',
  'pending_approval',
  'completed',
  'failed',
  'cancelled',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const TASK_RESULT_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
] as const;

export type TaskResultStatus = (typeof TASK_RESULT_STATUSES)[number];
