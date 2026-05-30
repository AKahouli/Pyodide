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
  | { type: 'playbook_interrupt'; data: PlaybookInterruptEvent };

