import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FlowExecution,
  FlowExecutionSchema,
} from '../playbook-flow/schemas/playbook-flow-execution.schema';
import { PlaybookFlowModule } from '../playbook-flow/playbook-flow.module';
import { AgentModule } from '../agent/agent.module';
import { LogicalSearchEvaluationController } from './controllers/logical-search-evaluation.controller';
import { LogicalSearchEvaluationService } from './services/logical-search-evaluation.service';
import { LogicalSearchEvaluationRepository } from './repositories/logical-search-evaluation.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlowExecution.name, schema: FlowExecutionSchema },
    ]),
    PlaybookFlowModule,
    AgentModule,
  ],
  controllers: [LogicalSearchEvaluationController],
  providers: [LogicalSearchEvaluationService, LogicalSearchEvaluationRepository],
  exports: [LogicalSearchEvaluationService],
})
export class EvaluationLogicalSearchModule {}
