import { PlaybookAssistantAttachmentRepository } from './assistant-attachment.repository';
import { PlaybookAssistantMessageRepository } from './assistant-message.repository';
import { PlaybookAssistantOperationRepository } from './assistant-operation.repository';
import { PlaybookAssistantRequestRepository } from './assistant-request.repository';
import { PlaybookAssistantRevisionRepository } from './assistant-revision.repository';
import { PlaybookDesignMessageRepository } from './design-message.repository';
import { PlaybookDesignOperationRepository } from './design-operation.repository';
import { DynamicReasoningAttemptRepository } from './dynamic-reasoning-attempt.repository';
import { EvaluationBaselineRepository } from './evaluation-baseline.repository';
import { EvaluationExecutionRepository } from './evaluation-execution.repository';
import { ExecutionLeaseRepository } from './execution-lease.repository';
import { ExecutionRepository } from './execution.repository';
import { FlowRepository } from './flow.repository';
import { HitlMemoryRepository } from './hitl-memory.repository';
import { IdempotencyRepository } from './idempotency.repository';
import { MailEventLedgerRepository } from './mail-event-ledger.repository';
import { NodeTemplateRepository } from './node-template.repository';
import { OutputFormatRepository } from './output-format.repository';
import { PromptTemplateRepository } from './prompt-template.repository';
import { ReplayRunReportRepository } from './replay-run-report.repository';
import { RouterDecisionRepository } from './router-decision.repository';
import { SharedPlaybookRepository } from './shared-playbook.repository';
import { TaskResultRepository } from './task-result.repository';
import { ValidatedReplayRepository } from './validated-replay.repository';

/** Every playbook-flow repository, for the module's providers. */
export const PLAYBOOK_REPOSITORIES = [
  PlaybookAssistantAttachmentRepository,
  PlaybookAssistantMessageRepository,
  PlaybookAssistantOperationRepository,
  PlaybookAssistantRequestRepository,
  PlaybookAssistantRevisionRepository,
  PlaybookDesignMessageRepository,
  PlaybookDesignOperationRepository,
  DynamicReasoningAttemptRepository,
  EvaluationBaselineRepository,
  EvaluationExecutionRepository,
  ExecutionLeaseRepository,
  ExecutionRepository,
  FlowRepository,
  HitlMemoryRepository,
  IdempotencyRepository,
  MailEventLedgerRepository,
  NodeTemplateRepository,
  OutputFormatRepository,
  PromptTemplateRepository,
  ReplayRunReportRepository,
  RouterDecisionRepository,
  SharedPlaybookRepository,
  TaskResultRepository,
  ValidatedReplayRepository,
];
