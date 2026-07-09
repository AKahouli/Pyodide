import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { AdminGuardrailsController } from './controllers/admin-guardrails.controller';
import { GuardrailsSettings, GuardrailsSettingsSchema } from './schemas/guardrails-settings.schema';
import { GuardrailsSettingsService } from './services/guardrails-settings.service';

@Module({
  imports: [
    AuthorizationModule,
    MongooseModule.forFeature([{ name: GuardrailsSettings.name, schema: GuardrailsSettingsSchema }]),
  ],
  controllers: [AdminGuardrailsController],
  providers: [GuardrailsSettingsService],
  exports: [GuardrailsSettingsService],
})
export class GuardrailsModule {}
