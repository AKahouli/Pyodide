import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import emailConfig from '../../config/email.config';
import { EmailService } from './email.service';
import { EmailConnectionService } from './email-connection.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(emailConfig)],
  providers: [EmailConnectionService, EmailService],
  exports: [EmailService, EmailConnectionService],
})
export class EmailModule {}
