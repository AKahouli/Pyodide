import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegistrationApproval, UserStatus } from '../user.types';
import { USER_STORE, type UserRecord, type UserStore } from '../persistence/user.store';
import type {
  PendingRegistrationNotice,
  RegistrationDecisionResult,
} from '../interfaces/registration-approval.interface';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { EmailService, EmailTemplateRenderer, EmailTemplate } from '@modules/email';
import { LoggerService } from '@modules/logger';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { buildFrontendHashUrl } from '../utils/frontend-url';
import { formatRegistrationRequestedAt } from '../utils/format-requested-at';

const SUPER_ADMIN_ROLE = 'super_admin';

@Injectable()
export class RegistrationApprovalService {
  private readonly appName: string;
  private readonly frontendUrl: string;

  constructor(
    @Inject(USER_STORE) private readonly userStore: UserStore,
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
    const updated = await this.userStore.update(userId, {
      status: UserStatus.ACTIVE,
      registrationApproval: RegistrationApproval.APPROVED,
    });

    if (wasInactive && updated) {
      await this.sendAccessActivatedEmail(updated.id, updated.email);
    }

    return this.toDecisionResult(updated ?? user, true);
  }

  async rejectRegistration(userId: string): Promise<RegistrationDecisionResult> {
    const user = await this.requireUser(userId);
    this.assertCanReject(user);

    if (user.registrationApproval === RegistrationApproval.REJECTED) {
      return this.toDecisionResult(user, false);
    }

    const updated = await this.userStore.update(userId, {
      registrationApproval: RegistrationApproval.REJECTED,
    });
    return this.toDecisionResult(updated ?? user, true);
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
    const content = await this.emailTemplateRenderer.render(EmailTemplate.REGISTRATION_PENDING_ADMIN, {
      appName: this.appName,
      applicantEmail: notice.email,
      requestedAt: formatRegistrationRequestedAt(requestedAt),
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

    const users = await this.userStore.findActiveByRole(role.id);
    return [...new Set(users.map((user) => user.email).filter(Boolean))];
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.userStore.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }
    return user;
  }

  private assertCanApprove(user: UserRecord): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Suspended accounts must be activated, not approved for registration',
      );
    }
  }

  private assertCanReject(user: UserRecord): void {
    if (user.status !== UserStatus.INACTIVE) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Only inactive accounts can be rejected',
      );
    }
  }

  private isAlreadyApproved(user: UserRecord): boolean {
    return (
      user.status === UserStatus.ACTIVE &&
      user.registrationApproval === RegistrationApproval.APPROVED
    );
  }

  private toDecisionResult(
    user: UserRecord,
    changed: boolean,
  ): RegistrationDecisionResult {
    return {
      changed,
      userId: user.id,
      email: user.email,
      status: user.status as UserStatus,
      registrationApproval: (user.registrationApproval ?? undefined) as RegistrationApproval | undefined,
    };
  }

  private buildAdminUsersUrl(): string {
    return buildFrontendHashUrl(this.frontendUrl, '/admin/users');
  }

  private buildLoginUrl(): string {
    return buildFrontendHashUrl(this.frontendUrl, '/');
  }

  private async sendAccessActivatedEmail(userId: string, email: string): Promise<void> {
    try {
      if (!this.emailService.isAvailable()) {
        this.logger.warn('Email service not available, skipping registration approval email', {
          userId,
        });
        return;
      }

      const content = await this.emailTemplateRenderer.render(EmailTemplate.REGISTRATION_APPROVED, {
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
          userId,
          error: result.error,
        });
      }
    } catch (error) {
      this.logger.error('Failed to send registration approval email', {
        userId,
        error: (error as Error).message,
      });
    }
  }
}
