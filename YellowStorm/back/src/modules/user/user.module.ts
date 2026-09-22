import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './user.service';
import { RegistrationApprovalService } from './registration-approval.service';
import { UserController } from './user.controller';
import { AdminUserController } from './admin-user.controller';
import { UsageModule } from '../usage/usage.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { HumainAgentModule } from '../humain-agent/humain-agent.module';
import { PgUserLookupAdapter } from './adapters/pg-user-lookup.adapter';
import { USER_LOOKUP_PORT } from '@common/ports/user-lookup.port';
import { USER_STORE } from './persistence/user.store';
import { PgUserStore } from './persistence/pg-user.store';

@Module({
  imports: [
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
    HumainAgentModule,
  ],
  controllers: [UserController, AdminUserController],
  providers: [
    UserService,
    RegistrationApprovalService,
    PgUserLookupAdapter,
    { provide: USER_LOOKUP_PORT, useExisting: PgUserLookupAdapter },
    { provide: USER_STORE, useClass: PgUserStore },
    PgUserStore,
  ],
  exports: [
    UserService,
    RegistrationApprovalService,
    PgUserLookupAdapter,
    USER_LOOKUP_PORT,
    USER_STORE,
  ],
})
export class UserModule {}
