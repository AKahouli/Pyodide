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
import { ModelsModule } from '../models/models.module';
import { EvaluationSettings, EvaluationSettingsSchema } from './schemas/evaluation-settings.schema';
import { EvaluationSettingsService } from './services/evaluation-settings.service';
import { AdminEvaluationSettingsController } from './controllers/admin-evaluation-settings.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Evaluation.name, schema: EvaluationSchema },
            { name: Dataset.name, schema: DatasetSchema },
            { name: Scenario.name, schema: ScenarioSchema },
            { name: EvaluationSettings.name, schema: EvaluationSettingsSchema },
        ]),
        AgentModule,
        AuthModule,
        ModelsModule,
    ],
    controllers: [EvaluationController, ScenarioController, AdminEvaluationSettingsController],
    providers: [EvaluationService, ScenarioService, EvaluationSettingsService],
    exports: [EvaluationService, ScenarioService, EvaluationSettingsService],
})
export class EvaluationModule { }
