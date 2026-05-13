import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { LoggerModule, LoggerService } from '@modules/logger';
import { AgentModule } from '@modules/agent/agent.module';
import { ModelsModule } from '@modules/models/models.module';
import { UsageModule } from '@modules/usage/usage.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { PlaybookModule } from '@modules/playbook/playbook.module';

import playbookFlowConfig from '@config/playbook-flow.config';

import { Flow, FlowSchema } from './schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionSchema } from './schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultSchema } from './schemas/playbook-flow-task-result.schema';
import { FlowRouterDecision, FlowRouterDecisionSchema } from './schemas/playbook-flow-router-decision.schema';
import { FlowNodeTemplate, FlowNodeTemplateSchema } from './schemas/playbook-flow-node-template.schema';
import { FlowPromptTemplate, FlowPromptTemplateSchema } from './schemas/playbook-flow-prompt-template.schema';
import { FlowOutputFormat, FlowOutputFormatSchema } from './schemas/playbook-flow-output-format.schema';
import { FlowDesignMessage, FlowDesignMessageSchema } from './schemas/playbook-flow-design-message.schema';

import { PlaybookFlowController } from './controllers/playbook-flow.controller';
import { PlaybookFlowExecutionController } from './controllers/playbook-flow-execution.controller';
import { PlaybookFlowTemplateController } from './controllers/playbook-flow-template.controller';

import { PlaybookFlowService } from './services/playbook-flow.service';
import { PlaybookFlowValidatorService } from './services/playbook-flow-validator.service';
import { PlaybookFlowBuilderService } from './services/playbook-flow-builder.service';
import { PlaybookFlowExecutionService } from './services/playbook-flow-execution.service';
import { PlaybookFlowResultsService } from './services/playbook-flow-results.service';
import { PlaybookFlowQueueService } from './services/playbook-flow-queue.service';
import { PlaybookFlowIdempotencyService } from './services/playbook-flow-idempotency.service';
import { PlaybookFlowNodeTemplateService } from './services/playbook-flow-node-template.service';
import { PlaybookFlowPromptTemplateService } from './services/playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './services/playbook-flow-prompt-renderer.service';
import { PlaybookFlowSettingsService } from './services/playbook-flow-settings.service';
import { PlaybookFlowContextService } from './services/playbook-flow-context.service';
import { PlaybookFlowOutputFormatService } from './services/playbook-flow-output-format.service';
import { PlaybookFlowDesignService } from './services/playbook-flow-design.service';
import { PlaybookFlowAdvisorService } from './services/playbook-flow-advisor.service';

@Module({
  imports: [
    ConfigModule.forFeature(playbookFlowConfig),
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
      { name: FlowExecution.name, schema: FlowExecutionSchema },
      { name: FlowTaskResult.name, schema: FlowTaskResultSchema },
      { name: FlowRouterDecision.name, schema: FlowRouterDecisionSchema },
      { name: FlowNodeTemplate.name, schema: FlowNodeTemplateSchema },
      { name: FlowPromptTemplate.name, schema: FlowPromptTemplateSchema },
      { name: FlowOutputFormat.name, schema: FlowOutputFormatSchema },
      { name: FlowDesignMessage.name, schema: FlowDesignMessageSchema },
    ]),
    JwtModule.register({}),
    AuthModule,
    AuthorizationModule,
    LoggerModule,
    AgentModule,
    ModelsModule,
    UsageModule,
    WorkspaceModule,
    PlaybookModule,
  ],
  controllers: [
    PlaybookFlowTemplateController,
    PlaybookFlowExecutionController,
    PlaybookFlowController,
  ],
  providers: [
    PlaybookFlowService,
    PlaybookFlowValidatorService,
    PlaybookFlowBuilderService,
    PlaybookFlowExecutionService,
    PlaybookFlowResultsService,
    PlaybookFlowQueueService,
    PlaybookFlowIdempotencyService,
    PlaybookFlowNodeTemplateService,
    PlaybookFlowPromptTemplateService,
    PlaybookFlowPromptRendererService,
    PlaybookFlowSettingsService,
    PlaybookFlowContextService,
    PlaybookFlowOutputFormatService,
    PlaybookFlowDesignService,
    PlaybookFlowAdvisorService,
  ],
  exports: [
    PlaybookFlowService,
    PlaybookFlowExecutionService,
    PlaybookFlowBuilderService,
    PlaybookFlowValidatorService,
    PlaybookFlowResultsService,
    PlaybookFlowNodeTemplateService,
    PlaybookFlowPromptTemplateService,
    PlaybookFlowPromptRendererService,
    PlaybookFlowSettingsService,
    PlaybookFlowDesignService,
    PlaybookFlowAdvisorService,
  ],
})
export class PlaybookFlowModule {}
