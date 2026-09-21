import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UserService } from './user.service';
import { RegistrationApprovalService } from './registration-approval.service';
import { UserController } from './user.controller';
import { AdminUserController } from './admin-user.controller';
import { UsageModule } from '../usage/usage.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { HumainAgentModule } from '../humain-agent/humain-agent.module';
import { MongoUserLookupAdapter } from './adapters/mongo-user-lookup.adapter';
import { PgUserLookupAdapter } from './adapters/pg-user-lookup.adapter';
import { USER_LOOKUP_PORT } from '@common/ports/user-lookup.port';
import { USER_STORE } from './persistence/user.store';
import { MongoUserStore } from './persistence/mongo-user.store';
import { PgUserStore } from './persistence/pg-user.store';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
    HumainAgentModule,
  ],
  controllers: [UserController, AdminUserController],
  providers: [
    UserService,
    RegistrationApprovalService,
    MongoUserLookupAdapter,
    PgUserLookupAdapter,
    { provide: USER_LOOKUP_PORT, useExisting: PgUserLookupAdapter },
    { provide: USER_STORE, useClass: PgUserStore },
    PgUserStore,
  ],
  exports: [
    UserService,
    RegistrationApprovalService,
    MongoUserLookupAdapter,
    PgUserLookupAdapter,
    USER_LOOKUP_PORT,
    USER_STORE,
    MongooseModule, // Export MongooseModule to allow other modules to use User model
  ],
})
export class UserModule {}
