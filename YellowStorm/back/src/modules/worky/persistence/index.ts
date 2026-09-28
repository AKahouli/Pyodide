import { WorkyAuditRepository } from './worky-audit.repository';
import { WorkyBudgetRepository } from './worky-budget.repository';
import { WorkyGovernanceRepository } from './worky-governance.repository';
import { WorkyInteractionRepository } from './worky-interaction.repository';
import { WorkyMailRepository } from './worky-mail.repository';
import { WorkyMemoryRepository } from './worky-memory.repository';
import { WorkyMessageRepository } from './worky-message.repository';
import { WorkyMirrorRepository } from './worky-mirror.repository';
import { WorkyPlanRepository } from './worky-plan.repository';
import { WorkyReportRepository } from './worky-report.repository';
import { WorkySchedulerRepository } from './worky-scheduler.repository';
import { WorkyStreamRepository } from './worky-stream.repository';
import { WorkyTaskRepository } from './worky-task.repository';
import { WorkyTaskResultRepository } from './worky-task-result.repository';

export * from './worky-audit.repository';
export * from './worky-budget.repository';
export * from './worky-governance.repository';
export * from './worky-interaction.repository';
export * from './worky-mail.repository';
export * from './worky-memory.repository';
export * from './worky-message.repository';
export * from './worky-mirror.repository';
export * from './worky-plan.repository';
export * from './worky-report.repository';
export * from './worky-scheduler.repository';
export * from './worky-stream.repository';
export * from './worky-task.repository';
export * from './worky-task-result.repository';

/** Every worky repository, for the module's providers. */
export const WORKY_REPOSITORIES = [
  WorkyAuditRepository,
  WorkyBudgetRepository,
  WorkyGovernanceRepository,
  WorkyInteractionRepository,
  WorkyMailRepository,
  WorkyMemoryRepository,
  WorkyMessageRepository,
  WorkyMirrorRepository,
  WorkyPlanRepository,
  WorkyReportRepository,
  WorkySchedulerRepository,
  WorkyStreamRepository,
  WorkyTaskRepository,
  WorkyTaskResultRepository,
];
