import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import emailConfig from '../../config/email.config';
import { EmailService } from './email.service';
import { EmailConnectionService } from './email-connection.service';
import { EmailTemplateRenderer } from './email-template-renderer.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(emailConfig)],
  providers: [EmailConnectionService, EmailService, EmailTemplateRenderer],
  exports: [EmailService, EmailConnectionService, EmailTemplateRenderer],
})
export class EmailModule {}
