import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService, EmailTemplateRenderer, EmailTemplate } from '../../email';
import { LoggerService } from '../../logger';
import type { DeviceInfoData } from '../interfaces/auth.interface';

/**
 * Transactional e-mails owned by the auth module: address verification,
 * password reset and new-login-location alerts.
 *
 * Rendering and sending live here so the auth flows only orchestrate. These are
 * best-effort notifications: a missing transport or a failed send is logged and
 * never thrown — callers keep their own success/failure semantics.
 */
@Injectable()
export class AuthEmailService {
  private readonly appName: string;
  private readonly frontendUrl: string;
  private readonly passwordResetExpiryHours: number;

  constructor(
    private readonly emailService: EmailService,
    private readonly emailTemplateRenderer: EmailTemplateRenderer,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AuthEmailService.name);
    this.appName = this.configService.get<string>('app.name', 'YelloStorm');
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
    this.passwordResetExpiryHours = this.configService.get<number>('auth.passwordResetExpiry', 1);
  }

  /** Verification magic-link e-mail (`/#/verify-email?token=…`). */
  async sendVerificationEmail(userId: string, email: string, token: string): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping verification email');
      return;
    }

    const verificationUrl = `${this.frontendUrl}/#/verify-email?token=${token}`;
    const { subject, html, text, attachments } = await this.emailTemplateRenderer.render(
      EmailTemplate.VERIFY_EMAIL,
      {
        appUrl: this.frontendUrl,
        appName: this.appName,
        verificationUrl,
      },
    );

    const result = await this.emailService.send({
      to: email,
      subject,
      html,
      text,
      attachments,
    });

    if (!result.success) {
      this.logger.error('Failed to send verification email', { userId, error: result.error });
    }
  }

  /** Password-reset e-mail (`/#/reset-password?token=…`), high priority. */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping password reset email');
      return;
    }

    const resetUrl = `${this.frontendUrl}/#/reset-password?token=${token}`;
    const { subject, html, text, attachments } = await this.emailTemplateRenderer.render(
      EmailTemplate.PASSWORD_RESET,
      {
        appUrl: this.frontendUrl,
        appName: this.appName,
        resetUrl,
        passwordResetExpiryHours: String(this.passwordResetExpiryHours),
        passwordResetExpirySuffix: this.passwordResetExpiryHours > 1 ? 's' : '',
      },
    );

    const result = await this.emailService.send({
      to: email,
      subject,
      html,
      text,
      attachments,
      priority: 'high',
    });

    if (!result.success) {
      this.logger.error('Failed to send password reset email', { error: result.error });
    }
  }

  /** Security alert for a login from a previously unseen IP. */
  async sendNewLocationAlertEmail(
    userId: string,
    email: string,
    ipAddress: string,
    deviceInfo: DeviceInfoData,
  ): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping new location alert');
      return;
    }

    const loginTime = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const deviceDescription = [
      deviceInfo.browser,
      deviceInfo.os,
      deviceInfo.deviceType !== 'desktop' ? deviceInfo.deviceType : null,
    ]
      .filter(Boolean)
      .join(' on ');

    const { subject, html, text, attachments } = await this.emailTemplateRenderer.render(
      EmailTemplate.NEW_LOGIN_ALERT,
      {
        appUrl: this.frontendUrl,
        appName: this.appName,
        loginTime,
        ipAddress,
        deviceDescription: deviceDescription || 'Unknown device',
        securityUrl: `${this.frontendUrl}/#/`,
      },
    );

    const result = await this.emailService.send({
      to: email,
      subject,
      html,
      text,
      attachments,
      priority: 'high',
    });

    if (!result.success) {
      this.logger.error('Failed to send new location alert email', { userId, error: result.error });
    } else {
      this.logger.log('New location alert sent', { userId });
    }
  }
}
