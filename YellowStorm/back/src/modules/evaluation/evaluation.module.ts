import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { ScenarioController } from './scenario.controller';
import { ScenarioService } from './scenario.service';
import { Evaluation, EvaluationSchema } from './schemas/evaluation.schema';
import { Dataset, DatasetSchema } from './schemas/dataset.schema';
import { Scenario, ScenarioSchema } from './schemas/scenario.schema';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Evaluation.name, schema: EvaluationSchema },
            { name: Dataset.name, schema: DatasetSchema },
            { name: Scenario.name, schema: ScenarioSchema },
        ]),
        AgentModule,
        AuthModule,
    ],
    controllers: [EvaluationController, ScenarioController],
    providers: [EvaluationService, ScenarioService],
    exports: [EvaluationService, ScenarioService],
})
export class EvaluationModule { }
