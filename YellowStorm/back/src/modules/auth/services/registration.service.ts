import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserService } from '../../user/services/user.service';
import { UserInvitationService } from '../../user/services/user-invitation.service';
import type { UserInvitationGrant } from '../../user/interfaces/user-invitation.interface';
import { RegistrationApproval, UserStatus } from '../../user/user.types';
import { LoggerService } from '../../logger';
import { UsageService } from '../../usage';
import { SystemService } from '../../system/system.service';
import { WorkspaceInitializerService } from '../../workspace/workspace-initializer.service';
import { HumainAgentService } from '../../humain-agent/humain-agent.service';
import { ConflictException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { RegisterDto } from '../dto/register.dto';
import { AuthEmailService } from './auth-email.service';

const REGISTER_RESPONSE_MESSAGE =
  'If this email can be registered, a verification link has been sent. Please check your inbox.';

/**
 * Account creation (self-service registration, optionally invitation-gated).
 *
 * Owns the anti-enumeration contract (identical body/status/latency whether or
 * not the email already exists), the invitation grant (roles, pre-approval and
 * plan), and the best-effort provisioning that must never fail registration
 * (plan assignment, personal workspace, human agent, verification e-mail).
 */
@Injectable()
export class RegistrationService {
  private readonly bcryptRounds: number;
  private readonly registerMinDurationMs: number;

  constructor(
    private readonly userService: UserService,
    private readonly userInvitations: UserInvitationService,
    private readonly authEmailService: AuthEmailService,
    @Inject(forwardRef(() => UsageService))
    private readonly usageService: UsageService,
    @Inject(forwardRef(() => WorkspaceInitializerService))
    private readonly workspaceInitializer: WorkspaceInitializerService,
    private readonly humainAgentService: HumainAgentService,
    private readonly systemService: SystemService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(RegistrationService.name);
    this.bcryptRounds = this.configService.get<number>('auth.bcryptRounds', 12);
    this.registerMinDurationMs = this.configService.get<number>('auth.registerMinDurationMs', 1000);
  }

  /** Register a new user. */
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const startedAt = Date.now();
    if (!this.systemService.isRegistrationEnabled()) {
      throw new ForbiddenException(
        ErrorCode.REGISTRATION_DISABLED,
        'User registration is currently disabled.',
      );
    }

    // Invitation-gated registration: the invitee holds the link, so expired /
    // used / mismatched invitations get their own explicit errors instead of
    // the anti-enumeration generic body used below for uninvited emails.
    let invitationGrant: UserInvitationGrant | null = null;
    if (dto.inviteToken) {
      invitationGrant = await this.userInvitations.assertUsableForEmail(dto.inviteToken, dto.email);
    }

    let user: Awaited<ReturnType<UserService['create']>>;
    try {
      user = await this.userService.create({
        email: dto.email,
        password: dto.password,
        // Invited users were authorised up front by a Super Admin: they are
        // created active and pre-approved (no manual review, no pending page)
        // with the roles chosen at invitation time.
        ...(invitationGrant
          ? {
              status: UserStatus.ACTIVE,
              registrationApproval: RegistrationApproval.APPROVED,
              roleIds: invitationGrant.roleIds,
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof ConflictException && error.code === ErrorCode.USER_ALREADY_EXISTS) {
        return await this.registerResultForExistingEmail(dto.password, startedAt);
      }
      throw error;
    }

    // Phase 2: claim the invitation now that the account exists, so a failed
    // registration never burns the link.
    if (dto.inviteToken) {
      await this.userInvitations.markConsumed(dto.inviteToken);
    }

    const assignedPlan = await this.provisionPlan(user._id, invitationGrant?.planId);
    await this.provisionWorkspace(user._id, assignedPlan?.workspaceStorageBytes);

    // Create the user's human agent (empty role/description until profile completion)
    await this.humainAgentService.ensureForUser({
      userId: user._id,
      email: user.email,
    });

    this.logger.log('User registered', { userId: user._id });

    // Not awaited: SMTP latency must not distinguish a new registration from an existing email.
    if (user.emailVerificationToken) {
      this.authEmailService.sendVerificationEmail(user._id, user.email, user.emailVerificationToken).catch((err: unknown) => {
        this.logger.warn('Failed to send verification email after registration', {
          userId: user._id,
          error: (err as Error).message,
        });
      });
    } else {
      this.logger.warn('Registered user has no verification token, skipping verification email', { userId: user._id });
    }

    await this.padRegisterDuration(startedAt);
    return { message: REGISTER_RESPONSE_MESSAGE };
  }

  /**
   * An already-registered email must be indistinguishable from a new
   * registration (same status, same body, similar latency), otherwise the
   * endpoint is an account-enumeration oracle. The password is hashed anyway
   * to match the cost of the real path; nothing about the email is logged.
   */
  private async registerResultForExistingEmail(password: string, startedAt: number): Promise<{ message: string }> {
    await bcrypt.hash(password, this.bcryptRounds);
    this.logger.log('Registration attempted for an existing account');
    await this.padRegisterDuration(startedAt);
    return { message: REGISTER_RESPONSE_MESSAGE };
  }

  /**
   * Both register outcomes wait until a common floor (measured from the start
   * of the call) has elapsed, so the cheaper existing-email path is not
   * measurably faster than user, plan, workspace and agent creation.
   */
  private async padRegisterDuration(startedAt: number): Promise<void> {
    const remainingMs = this.registerMinDurationMs - (Date.now() - startedAt);
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  /**
   * Assign the invited plan, or the platform default when none was chosen or
   * the invited plan is no longer available. Never fails registration: a plan
   * outage is logged and the returned value is undefined.
   */
  private async provisionPlan(
    userId: string,
    invitedPlanId: string | null | undefined,
  ): Promise<{ workspaceStorageBytes?: number } | undefined> {
    try {
      let plan = null;
      if (invitedPlanId) {
        plan = await this.usageService.getPlanById(invitedPlanId).catch((error: unknown) => {
          this.logger.warn('Invited plan unavailable, falling back to the default plan', {
            userId,
            planId: invitedPlanId,
            error: (error as Error).message,
          });
          return null;
        });
      }
      const assignedPlan = plan ?? (await this.usageService.getDefaultPlan());
      await this.userService.assignPlan(userId, assignedPlan.id, assignedPlan.slug);
      this.logger.log('Plan assigned to user', { userId, planSlug: assignedPlan.slug });
      return assignedPlan;
    } catch (error) {
      // Log but don't fail registration if plan assignment fails
      this.logger.warn('Failed to assign plan to user', {
        userId,
        error: (error as Error).message,
      });
      return undefined;
    }
  }

  /** Create the personal workspace. Never fails registration. */
  private async provisionWorkspace(userId: string, workspaceStorageBytes?: number): Promise<void> {
    try {
      await this.workspaceInitializer.getOrCreatePersonalWorkspace(
        userId,
        workspaceStorageBytes ?? 100 * 1024 * 1024, // 100MB default
      );
      this.logger.log('Personal workspace created for new user', { userId });
    } catch (error) {
      this.logger.warn('Failed to create personal workspace for user', {
        userId,
        error: (error as Error).message,
      });
    }
  }
}
