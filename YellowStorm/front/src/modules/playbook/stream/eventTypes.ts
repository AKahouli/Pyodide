import type {
  PlaybookAdvisorAutopilotUpdatedEvent,
  PlaybookExecutionCompleteEvent,
  PlaybookExecutionStartEvent,
  PlaybookInterruptEvent,
  PlaybookIteratorChildStepCompleteEvent,
  PlaybookIteratorChildStepStartEvent,
  PlaybookIteratorChildStepUpdateEvent,
  PlaybookJudgeSummaryUpdatedEvent,
  PlaybookOutputFormatTemplateUpdatedEvent,
  PlaybookReplayFormatGuideUpdatedEvent,
  PlaybookStepCompleteEvent,
  PlaybookStepEvaluationUpdatedEvent,
  PlaybookStepJudgeStartedEvent,
  PlaybookStepJudgeUpdatedEvent,
  PlaybookStepStartEvent,
  PlaybookStepUpdateEvent,
  DynamicReasoningStreamUpdate,
} from '@/modules/playbook/types';

export type PlaybookStreamEvent =
  | { type: 'playbook_connected'; data: { activeExecutions?: unknown[] } }
  | { type: 'playbook_execution_start'; data: PlaybookExecutionStartEvent }
  | { type: 'playbook_step_start'; data: PlaybookStepStartEvent }
  | { type: 'playbook_step_update'; data: PlaybookStepUpdateEvent }
  | { type: 'playbook_step_complete'; data: PlaybookStepCompleteEvent }
  | { type: 'playbook_iterator_child_step_start'; data: PlaybookIteratorChildStepStartEvent }
  | { type: 'playbook_iterator_child_step_update'; data: PlaybookIteratorChildStepUpdateEvent }
  | { type: 'playbook_iterator_child_step_complete'; data: PlaybookIteratorChildStepCompleteEvent }
  | { type: 'playbook_step_judge_started'; data: PlaybookStepJudgeStartedEvent }
  | { type: 'playbook_step_judge_updated'; data: PlaybookStepJudgeUpdatedEvent }
  | { type: 'playbook_step_evaluation_updated'; data: PlaybookStepEvaluationUpdatedEvent }
  | { type: 'playbook_judge_summary_updated'; data: PlaybookJudgeSummaryUpdatedEvent }
  | { type: 'playbook_advisor_autopilot_updated'; data: PlaybookAdvisorAutopilotUpdatedEvent }
  | { type: 'playbook_replay_format_guide_updated'; data: PlaybookReplayFormatGuideUpdatedEvent }
  | { type: 'playbook_output_format_template_updated'; data: PlaybookOutputFormatTemplateUpdatedEvent }
  | { type: 'playbook_execution_complete' | 'playbook_execution_error'; data: PlaybookExecutionCompleteEvent }
  | { type: 'playbook_interrupt'; data: PlaybookInterruptEvent }
  | { type: 'playbook_hitl_interrupt_created'; data: PlaybookInterruptEvent }
  | { type: 'playbook_hitl_interrupt_updated'; data: Record<string, unknown> }
  | {
      type: 'playbook_hitl_interrupt_resolved';
      data: { executionId: string; interruptId: string; action: string; taskId?: string; scope?: string; remember?: boolean };
    }
  | { type: 'playbook_hitl_memory_suggested'; data: Record<string, unknown> }
  | { type: 'playbook_hitl_memory_saved'; data: Record<string, unknown> }
  | { type: 'playbook_hitl_blocker_disabled'; data: Record<string, unknown> }
  | { type: 'playbook_hitl_policy_updated'; data: Record<string, unknown> }
  | { type: 'playbook_replay_hitl_summary_updated'; data: Record<string, unknown> }
  | { type: 'playbook_shared'; data: { playbookId: string } }
  | { type: 'playbook_dynamic_reasoning_update' | 'playbook_runtime_subgraph_created' | 'playbook_runtime_subgraph_completed' | 'playbook_runtime_subgraph_failed'; data: DynamicReasoningStreamUpdate };
