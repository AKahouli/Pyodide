import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '@modules/email';
import { EmailTemplateRenderer } from '@modules/email/email-template-renderer.service';
import { EmailTemplate } from '@modules/email/email-template.constants';
import { BadRequestException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { logDomainEvent } from '../../logger/logger.service';
import {
  USER_INVITATION_STORE,
  type UserInvitationRecord,
  type UserInvitationStore,
} from '../persistence/user-invitation.store';
import type {
  UserInvitationDetails,
  UserInvitationGrant,
} from '../interfaces/user-invitation.interface';
import { buildFrontendHashUrl } from '../utils/frontend-url';
import { hashInvitationToken, issueInvitationToken } from '../utils/invitation-token';

/** Invitation lifetime. The requirement is exactly 24 hours. */
export const USER_INVITATION_TTL_HOURS = 24;

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
    roleIds?: string[];
    planId?: string | null;
  }): Promise<UserInvitationDetails> {
    const email = params.email.trim().toLowerCase();

    if (!this.email.isAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.USER_INVITE_EMAIL_FAILED,
        'Email service is not available',
      );
    }

    // Issuing a fresh invitation supersedes any previously pending one for the
    // same address, so only the newest link stays usable (one pending invite).
    const now = new Date();
    await this.store.consumePendingForEmail(email, now);

    const { token, hash } = issueInvitationToken();
    const expiresAt = new Date(now.getTime() + USER_INVITATION_TTL_HOURS * 60 * 60 * 1000);

    const invitation = await this.store.create({
      email,
      tokenHash: hash,
      invitedBy: params.invitedById,
      roleIds: params.roleIds ?? [],
      planId: params.planId ?? null,
      expiresAt,
    });

    try {
      await this.sendInviteEmail({ to: email, token });
    } catch (error) {
      // The link never reached the invitee, so its pending row must not linger
      // (the previous invitations were already superseded above). Cleanup is
      // best-effort: the send failure is the error that must surface.
      await this.store.deleteById(invitation.id).catch(() => undefined);
      throw error;
    }

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
   * unconsumed, unexpired, and bound to that exact address. Returns the roles
   * and plan the invitation grants the invitee. Throws explicit invitation
   * errors otherwise — the invitee holds the link, so this is not an
   * account-enumeration oracle.
   */
  async assertUsableForEmail(token: string, email: string): Promise<UserInvitationGrant> {
    const invitation = await this.loadValid(token, INVITE_REGISTER_ROUTE);
    if (invitation.email !== email.trim().toLowerCase()) {
      this.refuse(ErrorCode.AUTH_INVITE_EMAIL_MISMATCH, INVITE_REGISTER_ROUTE);
    }

    return { roleIds: invitation.roleIds, planId: invitation.planId };
  }

  /**
   * Atomically claim the invitation for registration (phase 2, after the user
   * row exists). The conditional store update is the single-use enforcement
   * point. A lost claim is a handled outcome — the account is already created,
   * so it is neither thrown nor reported as an HTTP failure: the registration
   * request itself completed successfully.
   */
  async markConsumed(token: string): Promise<void> {
    const hash = hashInvitationToken(token);
    if (hash) {
      await this.store.consumeIfValid(hash, new Date());
    }
  }

  private async loadValid(
    token: string,
    route: { method: string; route: string },
  ): Promise<UserInvitationRecord> {
    const hash = hashInvitationToken(token);
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
    const base = this.config.get<string>('app.frontendUrl', 'http://localhost:5173');
    return buildFrontendHashUrl(base, `/?invite=${encodeURIComponent(token)}`);
  }
}
