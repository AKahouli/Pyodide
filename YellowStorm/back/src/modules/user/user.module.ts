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
  providers: [UserService, RegistrationApprovalService],
  exports: [
    UserService,
    RegistrationApprovalService,
    MongooseModule, // Export MongooseModule to allow other modules to use User model
  ],
})
export class UserModule {}
