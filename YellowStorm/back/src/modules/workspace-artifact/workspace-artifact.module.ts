import { Global, Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { SystemModule } from '../system/system.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { WorkspaceArtifactController } from './controllers/workspace-artifact.controller';
import { DecisionFlowValidatorService } from './services/decision-flow-validator.service';
import { DecisionFlowOutputParserService } from './services/decision-flow-output-parser.service';
import { DecisionFlowGenerationWorkerService } from './services/decision-flow-generation-worker.service';
import { WorkspaceArtifactService } from './services/workspace-artifact.service';
import { PostgresWorkspaceArtifactStore } from './persistence/postgres/postgres-workspace-artifact-store';
import { WorkspaceArtifactCleanupAdapter } from './ports/workspace-artifact-cleanup.adapter';

// Global so WorkspaceModule can inject WORKSPACE_ARTIFACT_CLEANUP_PORT without
// importing this module — a workspace→artifact import edge would create a
// CommonJS evaluation cycle that breaks app boot (ConnectorModule sees an
// undefined WorkspaceModule).
@Global()
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
    WorkspaceArtifactCleanupAdapter,
  ],
  exports: [WorkspaceArtifactService, DecisionFlowValidatorService, WorkspaceArtifactCleanupAdapter],
})
export class WorkspaceArtifactModule {}
