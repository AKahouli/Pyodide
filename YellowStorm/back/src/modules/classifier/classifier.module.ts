import { Module } from '@nestjs/common';
import { ClassifierFolderController } from './controllers/classifier-folder.controller';
import { ClassifierFileController } from './controllers/classifier-file.controller';
import { ClassifierRunController } from './controllers/classifier-run.controller';
import { ClassifierRuleController } from './controllers/classifier-rule.controller';
import { ClassifierSyncController } from './controllers/classifier-sync.controller';
import { ClassifierFolderRepository } from './persistence/classifier-folder.repository';
import { ClassifierAssignmentRepository } from './persistence/classifier-assignment.repository';
import { ClassifierRuleRepository } from './persistence/classifier-rule.repository';
import { ClassificationRunRepository } from './persistence/classification-run.repository';
import { ClassifierAccessService } from './services/classifier-access.service';
import { ClassifierFolderService } from './services/classifier-folder.service';
import { ClassifierFileService } from './services/classifier-file.service';
import { ClassifierRunService } from './services/classifier-run.service';
import { ClassifierRuleService } from './services/classifier-rule.service';
import { ClassifierSyncService } from './services/classifier-sync.service';
import { LoggerModule } from '../logger';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FlowReadPortModule } from '../playbook-flow/ports/flow-read-port.module';

// P6 cutover: the repositories read and write classifier.* through the global Drizzle connection.
@Module({
  imports: [
    WorkspaceModule,
    FlowReadPortModule,
    LoggerModule,
  ],
  controllers: [
    ClassifierFolderController,
    ClassifierFileController,
    ClassifierRunController,
    ClassifierRuleController,
    ClassifierSyncController,
  ],
  providers: [
    ClassifierFolderRepository,
    ClassifierAssignmentRepository,
    ClassifierRuleRepository,
    ClassificationRunRepository,
    ClassifierAccessService,
    ClassifierFolderService,
    ClassifierFileService,
    ClassifierRunService,
    ClassifierRuleService,
    ClassifierSyncService,
  ],
  exports: [
    ClassifierFolderService,
    ClassifierFileService,
    ClassifierRunService,
    ClassifierRuleService,
    ClassifierSyncService,
  ],
})
export class ClassifierModule {}
