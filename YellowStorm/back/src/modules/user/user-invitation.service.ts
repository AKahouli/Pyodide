import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '@modules/email';
import { EmailTemplateRenderer } from '@modules/email/email-template-renderer.service';
import { EmailTemplate } from '@modules/email/email-template.constants';
import { BadRequestException, ServiceUnavailableException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { logDomainEvent } from '../logger/logger.service';
import {
  USER_INVITATION_STORE,
  type UserInvitationRecord,
  type UserInvitationStore,
} from './persistence/user-invitation.store';

/** Invitation lifetime. The requirement is exactly 24 hours. */
export const USER_INVITATION_TTL_HOURS = 24;

export interface UserInvitationDetails {
  email: string;
  expiresAt: Date;
}

/** Route identity for refused-invite telemetry (registered `http.request.failed`). */
const INVITE_LOOKUP_ROUTE = { method: 'GET', route: '/auth/invite' } as const;
const INVITE_REGISTER_ROUTE = { method: 'POST', route: '/auth/register' } as const;

/**
 * Super-admin email invitations (identity.user_invitations).
 *
 * Security properties (mirrors the password-reset / app-share token rules):
 * - the raw token exists only in the email link; only its SHA-256 hash is stored;
 * - the token is single-use (atomic conditional consume) and valid 24h;
 * - the invited email is bound to the token, and registration must use it.
 */
@Injectable()
export class UserInvitationService {
  constructor(
    @Inject(USER_INVITATION_STORE) private readonly store: UserInvitationStore,
    private readonly email: EmailService,
    private readonly emailRenderer: EmailTemplateRenderer,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issue an invitation for `email` and send the invitation email. Returns the
   * invited address and expiry so the caller can report them back to the admin.
   */
  async invite(params: {
    email: string;
    invitedById: string;
  }): Promise<UserInvitationDetails> {
    const email = params.email.trim().toLowerCase();

    if (!this.email.isAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.USER_INVITE_EMAIL_FAILED,
        'Email service is not available',
      );
    }

    const { token, hash } = this.issueToken();
    const expiresAt = new Date(Date.now() + USER_INVITATION_TTL_HOURS * 60 * 60 * 1000);

    await this.store.create({
      email,
      tokenHash: hash,
      invitedBy: params.invitedById,
      expiresAt,
    });

    await this.sendInviteEmail({ to: email, token });

    return { email, expiresAt };
  }

  /**
   * Resolve a token for the public invite landing page. Refuses unknown,
   * already-consumed and expired tokens. Never returns the token itself.
   */
  async resolve(token: string): Promise<UserInvitationDetails> {
    const invitation = await this.loadValid(token, INVITE_LOOKUP_ROUTE);
    return { email: invitation.email, expiresAt: invitation.expiresAt };
  }

  /**
   * Validate that `token` may be used to register `email`: it must exist, be
   * unconsumed, unexpired, and bound to that exact address. Throws explicit
   * invitation errors otherwise — the invitee holds the link, so this is not
   * an account-enumeration oracle.
   */
  async assertUsableForEmail(token: string, email: string): Promise<void> {
    const invitation = await this.loadValid(token, INVITE_REGISTER_ROUTE);
    if (invitation.email === email.trim().toLowerCase()) return;

    this.refuse(ErrorCode.AUTH_INVITE_EMAIL_MISMATCH, INVITE_REGISTER_ROUTE);
  }

  /**
   * Atomically claim the invitation for registration (phase 2, after the user
   * row exists). The conditional store update is the single-use enforcement
   * point: a lost claim means another request used the token first, which is
   * a handled outcome here — the account already exists, so it is warned, not
   * thrown.
   */
  async markConsumed(token: string): Promise<void> {
    const hash = this.hashToken(token);
    const claimed = hash ? await this.store.consumeIfValid(hash, new Date()) : false;

    if (!claimed) {
      logDomainEvent('warn', 'http.request.failed', {
        method: INVITE_REGISTER_ROUTE.method,
        route: INVITE_REGISTER_ROUTE.route,
        status_code: 409,
      });
    }
  }

  private async loadValid(
    token: string,
    route: { method: string; route: string },
  ): Promise<UserInvitationRecord> {
    const hash = this.hashToken(token);
    const invitation = hash ? await this.store.findByTokenHash(hash) : null;

    if (!invitation || invitation.consumedAt) {
      this.refuse(ErrorCode.AUTH_INVITE_TOKEN_INVALID, route);
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      this.refuse(ErrorCode.AUTH_INVITE_TOKEN_EXPIRED, route);
    }

    return invitation;
  }

  /** Refused invite attempt: explicit client error plus a correlated outcome event. */
  private refuse(
    code: ErrorCode,
    route: { method: string; route: string },
  ): never {
    logDomainEvent('warn', 'http.request.failed', {
      method: route.method,
      route: route.route,
      status_code: 400,
    });
    throw new BadRequestException(code);
  }

  private issueToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashOf(token) };
  }

  /** SHA-256 hex of a non-empty token. */
  private hashOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** SHA-256 of the trimmed token; null for an empty/missing token. */
  private hashToken(token: string): string | null {
    const trimmed = token?.trim();
    return trimmed ? this.hashOf(trimmed) : null;
  }

  private async sendInviteEmail(params: { to: string; token: string }): Promise<void> {
    const { subject, html, text, attachments } = await this.emailRenderer.render(
      EmailTemplate.USER_INVITE,
      {
        appName: this.config.get<string>('app.name', 'YelloStorm'),
        inviteUrl: this.buildInviteUrl(params.token),
        expiresInHours: String(USER_INVITATION_TTL_HOURS),
      },
    );

    const result = await this.email.send({
      to: params.to,
      subject,
      html,
      text,
      attachments,
    });

    if (!result.success) {
      // Terminal dependency outcome; the detailed transport error stays with
      // EmailService (single detailed-error owner).
      logDomainEvent('error', 'dependency.request.failed', {
        dependency: 'smtp',
        operation: 'user_invitation.send',
        attempt: result.attempts,
      });
      throw new ServiceUnavailableException(
        ErrorCode.USER_INVITE_EMAIL_FAILED,
        'Failed to send invitation email',
      );
    }
  }

  /** Landing page route that opens the register modal with the email pre-filled. */
  private buildInviteUrl(token: string): string {
    const base = this.config.get<string>('app.frontendUrl', 'http://localhost:5173').replace(/\/+$/, '');
    return `${base}/#/?invite=${encodeURIComponent(token)}`;
  }
}
