import { Module } from '@nestjs/common';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { ScenarioController } from './scenario.controller';
import { ScenarioService } from './scenario.service';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { EvaluationSettingsService } from './services/evaluation-settings.service';
import { AdminEvaluationSettingsController } from './controllers/admin-evaluation-settings.controller';
import { EVALUATION_DATASET_STORE } from './persistence/evaluation-dataset.store';
import { EVALUATION_RUN_STORE } from './persistence/evaluation-run.store';
import { EVALUATION_SCENARIO_STORE } from './persistence/evaluation-scenario.store';
import { EVALUATION_SETTINGS_STORE } from './persistence/evaluation-settings.store';
import { PgEvaluationDatasetStore } from './persistence/pg-evaluation-dataset.store';
import { PgEvaluationRunStore } from './persistence/pg-evaluation-run.store';
import { PgEvaluationScenarioStore } from './persistence/pg-evaluation-scenario.store';
import { PgEvaluationSettingsStore } from './persistence/pg-evaluation-settings.store';

@Module({
    imports: [
        AgentModule,
        AuthModule,
        ModelsModule,
    ],
    controllers: [EvaluationController, ScenarioController, AdminEvaluationSettingsController],
    providers: [
        EvaluationService,
        ScenarioService,
        EvaluationSettingsService,
        // P6 cutover: datasets, runs, scenarios and the settings singleton live in agent_evaluation.*.
        { provide: EVALUATION_DATASET_STORE, useClass: PgEvaluationDatasetStore },
        { provide: EVALUATION_RUN_STORE, useClass: PgEvaluationRunStore },
        { provide: EVALUATION_SCENARIO_STORE, useClass: PgEvaluationScenarioStore },
        { provide: EVALUATION_SETTINGS_STORE, useClass: PgEvaluationSettingsStore },
    ],
    exports: [EvaluationService, ScenarioService, EvaluationSettingsService],
})
export class EvaluationModule { }
