import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Plan, PlanSchema } from './schemas/plan.schema';
import { PostgresModule } from '../postgres';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { UsageLimitGuard } from './guards/usage-limit.guard';
import { LoggerModule } from '../logger';
import { UserModule } from '../user/user.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PostgresUsageStore } from './persistence/postgres-usage-store';
import { USAGE_STORE } from './persistence/usage-store';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Plan.name, schema: PlanSchema }]),
    PostgresModule,
    LoggerModule,
    forwardRef(() => UserModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [UsageController],
  providers: [
    PostgresUsageStore,
    { provide: USAGE_STORE, useExisting: PostgresUsageStore },
    UsageService,
    UsageLimitGuard,
  ],
  exports: [UsageService, UsageLimitGuard, USAGE_STORE],
})
export class UsageModule {}
