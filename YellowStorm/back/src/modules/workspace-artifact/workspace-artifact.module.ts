import { Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { SystemModule } from '../system/system.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { WorkspaceArtifactController } from './controllers/workspace-artifact.controller';
import { DecisionFlowValidatorService } from './services/decision-flow-validator.service';
import { DecisionFlowOutputParserService } from './services/decision-flow-output-parser.service';
import { DecisionFlowGenerationWorkerService } from './services/decision-flow-generation-worker.service';
import { WorkspaceArtifactService } from './services/workspace-artifact.service';
import { WORKSPACE_ARTIFACT_STORE } from './persistence/workspace-artifact-store';
import { PostgresWorkspaceArtifactStore } from './persistence/postgres/postgres-workspace-artifact-store';
import {
  WORKSPACE_ARTIFACT_CLEANUP_PORT,
  WorkspaceArtifactCleanupAdapter,
} from './ports/workspace-artifact-cleanup.adapter';

@Module({
  imports: [
    forwardRef(() => WorkspaceModule),
    AgentModule,
    SystemModule,
  ],
  controllers: [WorkspaceArtifactController],
  providers: [
    WorkspaceArtifactService,
    DecisionFlowValidatorService,
    DecisionFlowOutputParserService,
    DecisionFlowGenerationWorkerService,
    PostgresWorkspaceArtifactStore,
    { provide: WORKSPACE_ARTIFACT_STORE, useExisting: PostgresWorkspaceArtifactStore },
    WorkspaceArtifactCleanupAdapter,
    { provide: WORKSPACE_ARTIFACT_CLEANUP_PORT, useExisting: WorkspaceArtifactCleanupAdapter },
  ],
  exports: [WorkspaceArtifactService, DecisionFlowValidatorService, WORKSPACE_ARTIFACT_CLEANUP_PORT],
})
export class WorkspaceArtifactModule {}
