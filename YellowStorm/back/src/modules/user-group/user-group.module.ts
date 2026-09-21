import { Module } from '@nestjs/common';
import { UserGroupService } from './user-group.service';
import { UserGroupController } from './user-group.controller';
import { UserModule } from '../user/user.module';
import { LoggerModule } from '../logger';
import { USER_GROUP_STORE } from './persistence/user-group.store';
import { PgUserGroupStore } from './persistence/pg-user-group.store';

@Module({
  imports: [
    UserModule,
    LoggerModule,
  ],
  controllers: [UserGroupController],
  providers: [
    UserGroupService,
    // Mongo-backed until the 1A cutover; swap useClass to PgUserGroupStore then.
    { provide: USER_GROUP_STORE, useClass: PgUserGroupStore },
    PgUserGroupStore,
  ],
  exports: [UserGroupService, USER_GROUP_STORE],
})
export class UserGroupModule {}
