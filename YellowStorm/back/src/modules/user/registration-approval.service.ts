import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { RegistrationApproval, User, UserDocument, UserStatus } from './schemas/user.schema';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { EmailService, EmailTemplateRenderer, EmailTemplate } from '@modules/email';
import { LoggerService } from '@modules/logger';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const SUPER_ADMIN_ROLE = 'super_admin';
const REQUESTED_AT_TIME_ZONE = 'Europe/Paris';

export interface PendingRegistrationNotice {
  userId: string;
  email: string;
  requestedAt?: Date;
}

export interface RegistrationDecisionResult {
  changed: boolean;
  userId: string;
  email: string;
  status: UserStatus;
  registrationApproval?: RegistrationApproval;
}

@Injectable()
export class RegistrationApprovalService {
  private readonly appName: string;
  private readonly frontendUrl: string;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly authorizationService: AuthorizationService,
    private readonly emailService: EmailService,
    private readonly emailTemplateRenderer: EmailTemplateRenderer,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(RegistrationApprovalService.name);
    this.appName = this.configService.get<string>('app.name', 'YelloStorm');
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
  }

  async approveRegistration(userId: string): Promise<RegistrationDecisionResult> {
    const user = await this.requireUser(userId);
    this.assertCanApprove(user);

    if (this.isAlreadyApproved(user)) {
      return this.toDecisionResult(user, false);
    }

    const wasInactive = user.status === UserStatus.INACTIVE;
    user.status = UserStatus.ACTIVE;
    user.registrationApproval = RegistrationApproval.APPROVED;
    await user.save();

    if (wasInactive) {
      await this.sendAccessActivatedEmail(user.email);
    }

    return this.toDecisionResult(user, true);
  }

  async rejectRegistration(userId: string): Promise<RegistrationDecisionResult> {
    const user = await this.requireUser(userId);
    this.assertCanReject(user);

    if (user.registrationApproval === RegistrationApproval.REJECTED) {
      return this.toDecisionResult(user, false);
    }

    user.registrationApproval = RegistrationApproval.REJECTED;
    await user.save();
    return this.toDecisionResult(user, true);
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
    const content = this.emailTemplateRenderer.render(EmailTemplate.REGISTRATION_PENDING_ADMIN, {
      appName: this.appName,
      applicantEmail: notice.email,
      requestedAt: this.formatRegistrationRequestedAt(requestedAt),
      usersAdminUrl: this.buildAdminUsersUrl(),
    });

    for (const to of emails) {
      const result = await this.emailService.send({
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: content.attachments,
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

  private async requireUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }
    return user;
  }

  private assertCanApprove(user: UserDocument): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Suspended accounts must be activated, not approved for registration',
      );
    }
  }

  private assertCanReject(user: UserDocument): void {
    if (user.status !== UserStatus.INACTIVE) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Only inactive accounts can be rejected',
      );
    }
  }

  private isAlreadyApproved(user: UserDocument): boolean {
    return (
      user.status === UserStatus.ACTIVE &&
      user.registrationApproval === RegistrationApproval.APPROVED
    );
  }

  private toDecisionResult(
    user: UserDocument,
    changed: boolean,
  ): RegistrationDecisionResult {
    return {
      changed,
      userId: user._id.toString(),
      email: user.email,
      status: user.status,
      registrationApproval: user.registrationApproval,
    };
  }

  private buildAdminUsersUrl(): string {
    const base = this.frontendUrl.replace(/\/$/, '');
    return `${base}/#/admin/users`;
  }

  private buildLoginUrl(): string {
    const base = this.frontendUrl.replace(/\/$/, '');
    return `${base}/#/`;
  }

  private formatRegistrationRequestedAt(date: Date): string {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: REQUESTED_AT_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);

    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';

    const day = value('day').padStart(2, '0');
    const month = value('month').padStart(2, '0');
    const year = value('year');
    const hour = value('hour').padStart(2, '0');
    const minute = value('minute').padStart(2, '0');

    return `${day}/${month}/${year} à ${hour}:${minute}`;
  }

  private async sendAccessActivatedEmail(email: string): Promise<void> {
    try {
      if (!this.emailService.isAvailable()) {
        this.logger.warn('Email service not available, skipping registration approval email', {
          email,
        });
        return;
      }

      const content = this.emailTemplateRenderer.render(EmailTemplate.REGISTRATION_APPROVED, {
        appName: this.appName,
        loginUrl: this.buildLoginUrl(),
      });
      const result = await this.emailService.send({
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: content.attachments,
      });
      if (!result.success) {
        this.logger.error('Failed to send registration approval email', {
          email,
          error: result.error,
        });
      }
    } catch (error) {
      this.logger.error('Failed to send registration approval email', {
        email,
        error: (error as Error).message,
      });
    }
  }
}
