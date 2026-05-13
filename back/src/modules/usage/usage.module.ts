import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Plan, PlanSchema } from './schemas/plan.schema';
import { Usage, UsageSchema } from './schemas/usage.schema';
import { UsageLog, UsageLogSchema } from './schemas/usage-log.schema';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { UsageLimitGuard } from './guards/usage-limit.guard';
import { LoggerModule } from '../logger';
import { UserModule } from '../user/user.module';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: UsageLog.name, schema: UsageLogSchema },
    ]),
    LoggerModule,
    forwardRef(() => UserModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [UsageController],
  providers: [UsageService, UsageLimitGuard],
  exports: [UsageService, UsageLimitGuard],
})
export class UsageModule {}
