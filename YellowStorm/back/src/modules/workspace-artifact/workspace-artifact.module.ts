import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentModule } from '../agent/agent.module';
import { SystemModule } from '../system/system.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { WorkspaceArtifactController } from './controllers/workspace-artifact.controller';
import { WorkspaceArtifact, WorkspaceArtifactSchema } from './schemas/workspace-artifact.schema';
import { DecisionFlowValidatorService } from './services/decision-flow-validator.service';
import { DecisionFlowOutputParserService } from './services/decision-flow-output-parser.service';
import { DecisionFlowGenerationWorkerService } from './services/decision-flow-generation-worker.service';
import { WorkspaceArtifactService } from './services/workspace-artifact.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkspaceArtifact.name, schema: WorkspaceArtifactSchema },
    ]),
    WorkspaceModule,
    AgentModule,
    SystemModule,
  ],
  controllers: [WorkspaceArtifactController],
  providers: [WorkspaceArtifactService, DecisionFlowValidatorService, DecisionFlowOutputParserService, DecisionFlowGenerationWorkerService],
  exports: [WorkspaceArtifactService, DecisionFlowValidatorService],
})
export class WorkspaceArtifactModule {}
