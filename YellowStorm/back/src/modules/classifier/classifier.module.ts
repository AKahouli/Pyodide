import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ClassifierFolder,
  ClassifierFolderSchema,
} from './schemas/classifier-folder.schema';
import {
  ClassifierFileAssignment,
  ClassifierFileAssignmentSchema,
} from './schemas/classifier-file-assignment.schema';
import {
  ClassificationRun,
  ClassificationRunSchema,
} from './schemas/classification-run.schema';
import {
  ClassifierRule,
  ClassifierRuleSchema,
} from './schemas/classifier-rule.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../workspace/schemas/workspace.schema';
import {
  WorkspaceShare,
  WorkspaceShareSchema,
} from '../workspace/schemas/workspace-share.schema';
import {
  WorkspaceDoc,
  WorkspaceDocumentSchema,
} from '../workspace/schemas/workspace-document.schema';
import { Flow, FlowSchema } from '../playbook-flow/schemas/playbook-flow.schema';
import { ClassifierFolderController } from './controllers/classifier-folder.controller';
import { ClassifierFileController } from './controllers/classifier-file.controller';
import { ClassifierRunController } from './controllers/classifier-run.controller';
import { ClassifierRuleController } from './controllers/classifier-rule.controller';
import { ClassifierSyncController } from './controllers/classifier-sync.controller';
import { ClassifierAccessService } from './services/classifier-access.service';
import { ClassifierFolderService } from './services/classifier-folder.service';
import { ClassifierFileService } from './services/classifier-file.service';
import { ClassifierRunService } from './services/classifier-run.service';
import { ClassifierRuleService } from './services/classifier-rule.service';
import { ClassifierSyncService } from './services/classifier-sync.service';
import { LoggerModule } from '../logger';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClassifierFolder.name, schema: ClassifierFolderSchema },
      { name: ClassifierFileAssignment.name, schema: ClassifierFileAssignmentSchema },
      { name: ClassificationRun.name, schema: ClassificationRunSchema },
      { name: ClassifierRule.name, schema: ClassifierRuleSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceShare.name, schema: WorkspaceShareSchema },
      { name: WorkspaceDoc.name, schema: WorkspaceDocumentSchema },
      { name: Flow.name, schema: FlowSchema },
    ]),
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
