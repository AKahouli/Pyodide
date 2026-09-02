import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserStatus } from './schemas/user.schema';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { EmailService } from '@modules/email';
import { LoggerService } from '@modules/logger';
import {
  buildRegistrationPendingAdminEmail,
  buildRegistrationReviewUrl,
} from './templates/registration-pending-admin.email';

const SUPER_ADMIN_ROLE = 'super_admin';

export interface PendingRegistrationNotice {
  userId: string;
  email: string;
  requestedAt?: Date;
}

@Injectable()
export class RegistrationApprovalService {
  private readonly appName: string;
  private readonly frontendUrl: string;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly authorizationService: AuthorizationService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(RegistrationApprovalService.name);
    this.appName = this.configService.get<string>('app.name', 'YelloStorm');
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
  }

  async notifySuperAdminsOfRegistration(notice: PendingRegistrationNotice): Promise<void> {
    try {
      await this.sendPendingRegistrationEmails(notice);
    } catch (error) {
      this.logger.error('Failed to notify super admins of registration', {
        userId: notice.userId,
        error: (error as Error).message,
      });
    }
  }

  private async sendPendingRegistrationEmails(notice: PendingRegistrationNotice): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping super admin registration notice', {
        userId: notice.userId,
      });
      return;
    }

    const emails = await this.findSuperAdminEmails();
    if (emails.length === 0) {
      this.logger.warn('No super admin recipients for registration notice', {
        userId: notice.userId,
      });
      return;
    }

    const requestedAt = notice.requestedAt ?? new Date();
    const content = buildRegistrationPendingAdminEmail({
      appName: this.appName,
      applicantEmail: notice.email,
      userId: notice.userId,
      requestedAt,
      approveUrl: buildRegistrationReviewUrl(this.frontendUrl, notice.userId, 'approve'),
      rejectUrl: buildRegistrationReviewUrl(this.frontendUrl, notice.userId, 'reject'),
    });

    for (const to of emails) {
      const result = await this.emailService.send({
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
      if (!result.success) {
        this.logger.error('Failed to send registration notice to super admin', {
          to,
          userId: notice.userId,
          error: result.error,
        });
      }
    }
  }

  private async findSuperAdminEmails(): Promise<string[]> {
    const role = await this.authorizationService.findRoleByName(SUPER_ADMIN_ROLE);
    if (!role) {
      return [];
    }

    const users = await this.userModel
      .find({ roles: new Types.ObjectId(role.id), status: UserStatus.ACTIVE })
      .select('email')
      .lean();

    return [...new Set(users.map((user) => user.email).filter(Boolean))];
  }
}
