import { Module, forwardRef } from '@nestjs/common';
import { PostgresModule } from '../postgres';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { UsageLimitGuard } from './guards/usage-limit.guard';
import { LoggerModule } from '../logger';
import { UserModule } from '../user/user.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PostgresUsageStore } from './persistence/postgres-usage-store';
import { PgPlanStore } from './persistence/pg-plan.store';

@Module({
  imports: [
    PostgresModule,
    LoggerModule,
    forwardRef(() => UserModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [UsageController],
  providers: [
    PostgresUsageStore,
    // Plans cutover (plan 1B.3.2): catalog.plans; Mongo data backfilled before this flip.
    PgPlanStore,
    UsageService,
    UsageLimitGuard,
  ],
  exports: [UsageService, UsageLimitGuard, PostgresUsageStore],
})
export class UsageModule {}
