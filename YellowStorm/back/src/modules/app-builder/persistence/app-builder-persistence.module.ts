import { Module } from '@nestjs/common';
import { PostgresModule } from '@modules/postgres';
import { SYSTEM_REVISION_SOURCE } from '@modules/app-runtime/ports/system-revision-source.port';
import {
  APP_BUILDER_TEMPLATE_CATEGORY_STORE,
  APP_BUILDER_TEMPLATE_STORE,
} from './app-builder-template.store';
import { AppBuilderTemplateRevisionSource } from './app-builder-template-revision.source';
import { PgAppBuilderSessionStore } from './postgres/pg-app-builder-session.store';
import { PgAppBuilderEventStore } from './postgres/pg-app-builder-event.store';
import { PgAppBuilderAppShareStore } from './postgres/pg-app-builder-app-share.store';
import {
  PgAppBuilderTemplateCategoryStore,
  PgAppBuilderTemplateStore,
} from './postgres/pg-app-builder-template.store';

@Module({
  imports: [PostgresModule],
  providers: [
    PgAppBuilderSessionStore,
    PgAppBuilderEventStore,
    PgAppBuilderAppShareStore,
    PgAppBuilderTemplateCategoryStore,
    PgAppBuilderTemplateStore,
    AppBuilderTemplateRevisionSource,
    {
      provide: APP_BUILDER_TEMPLATE_CATEGORY_STORE,
      useExisting: PgAppBuilderTemplateCategoryStore,
    },
    { provide: APP_BUILDER_TEMPLATE_STORE, useExisting: PgAppBuilderTemplateStore },
    { provide: SYSTEM_REVISION_SOURCE, useExisting: AppBuilderTemplateRevisionSource },
  ],
  exports: [
    PgAppBuilderSessionStore,
    PgAppBuilderEventStore,
    PgAppBuilderAppShareStore,
    PgAppBuilderTemplateCategoryStore,
    PgAppBuilderTemplateStore,
    APP_BUILDER_TEMPLATE_CATEGORY_STORE,
    APP_BUILDER_TEMPLATE_STORE,
    SYSTEM_REVISION_SOURCE,
  ],
})
export class AppBuilderPersistenceModule {}
