import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { AdminGuardrailsController } from './controllers/admin-guardrails.controller';
import { GuardrailsSettingsService } from './services/guardrails-settings.service';
import { PgGuardrailsSettingsStore } from './persistence/pg-guardrails-settings.store';

@Module({
  imports: [AuthorizationModule],
  controllers: [AdminGuardrailsController],
  providers: [
    GuardrailsSettingsService,
    // Guardrails cutover (plan 1B.2.3): singleton row on catalog.guardrails_settings.
    PgGuardrailsSettingsStore,
  ],
  exports: [GuardrailsSettingsService],
})
export class GuardrailsModule {}
