import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './services/user.service';
import { RegistrationApprovalService } from './services/registration-approval.service';
import { UserController } from './controllers/user.controller';
import { AdminUserController } from './controllers/admin-user.controller';
import { UsageModule } from '../usage/usage.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { HumainAgentModule } from '../humain-agent/humain-agent.module';
import { PgUserLookupAdapter } from './adapters/pg-user-lookup.adapter';
import { USER_LOOKUP_PORT } from '@common/ports/user-lookup.port';
import { USER_STORE } from './persistence/user.store';
import { PgUserStore } from './persistence/pg-user.store';
import { USER_INVITATION_STORE } from './persistence/user-invitation.store';
import { PgUserInvitationStore } from './persistence/pg-user-invitation.store';
import { UserInvitationService } from './services/user-invitation.service';

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
    UserInvitationService,
    PgUserLookupAdapter,
    { provide: USER_LOOKUP_PORT, useExisting: PgUserLookupAdapter },
    { provide: USER_STORE, useClass: PgUserStore },
    PgUserStore,
    { provide: USER_INVITATION_STORE, useClass: PgUserInvitationStore },
    PgUserInvitationStore,
  ],
  exports: [
    UserService,
    RegistrationApprovalService,
    UserInvitationService,
    PgUserLookupAdapter,
    USER_LOOKUP_PORT,
    USER_STORE,
    USER_INVITATION_STORE,
  ],
})
export class UserModule {}
