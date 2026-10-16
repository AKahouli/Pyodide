import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UserService } from '../../user/services/user.service';
import { asAuthUser } from '@common/auth/auth-user';
import { assertAccountAccessible } from '../../user/utils/assert-account-accessible';
import { LoggerService } from '../../logger';
import { AuthorizationService } from '../../authorization/authorization.service';
import { HumainAgentService } from '../../humain-agent/humain-agent.service';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoginDto } from '../dto/login.dto';
import { LoginResponse } from '../interfaces/auth.interface';
import { LoginLockoutService } from '../throttle/login-lockout.service';
import { parseUserAgent } from '../utils/device-info';
import { SessionService } from './session.service';
import { AuthEmailService } from './auth-email.service';

/**
 * Login and credential-recovery orchestration.
 *
 * Owns the anti-enumeration login contract (decoy bcrypt hash, uniform error),
 * the progressive lockout, the new-location alert and the password /
 * verification journeys. Session and refresh-token mechanics live in
 * {@link SessionService}; account creation in {@link RegistrationService};
 * transactional e-mails in {@link AuthEmailService}.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly bcryptRounds: number;
  private dummyPasswordHash?: Promise<string>;

  constructor(
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly authEmailService: AuthEmailService,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    private readonly humainAgentService: HumainAgentService,
    private readonly loginLockout: LoginLockoutService,
  ) {
    this.logger.setContext(AuthService.name);
    this.bcryptRounds = this.configService.get<number>('auth.bcryptRounds', 12);
  }

  /** Warm the decoy hash so the first unknown-email login is not measurably slower. */
  async onModuleInit(): Promise<void> {
    await this.getDummyPasswordHash();
  }

  /**
   * Decoy bcrypt hash at the configured cost, compared against when the email
   * is unknown so response time does not reveal whether an account exists.
   */
  private getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), this.bcryptRounds);
    return this.dummyPasswordHash;
  }

  /** Login with email and password. */
  async login(
    dto: LoginDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ loginResponse: LoginResponse; refreshToken: string }> {
    // Lock is per (IP, email) so an attacker cannot lock the real owner out;
    // the attempt is counted before the comparison so concurrent bursts are bounded.
    this.loginLockout.assertNotLocked(dto.email, ipAddress);
    const lockSeconds = this.loginLockout.reserveAttempt(dto.email, ipAddress);

    let user: Awaited<ReturnType<UserService['findByEmail']>>;
    let isPasswordValid: boolean;
    try {
      user = await this.userService.findByEmail(dto.email);
      // Unknown email and wrong password must be indistinguishable: same error,
      // and one bcrypt comparison either way (decoy hash when there is no user).
      isPasswordValid = user
        ? await this.userService.validatePassword(user, dto.password)
        : await bcrypt.compare(dto.password, await this.getDummyPasswordHash());
    } catch (error) {
      // Store outage etc.: not a credential failure, do not count it.
      this.loginLockout.release(dto.email, ipAddress);
      throw error;
    }
    if (!user || !isPasswordValid) {
      if (lockSeconds !== null) {
        // userId only; absent for unknown emails so the log cannot confirm an account.
        this.logger.warn('Login temporarily locked after repeated failures', {
          userId: user?._id,
          lockSeconds,
        });
      }
      throw new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    this.loginLockout.recordSuccess(dto.email, ipAddress);

    // Account state is only revealed to someone who proved the password.
    assertAccountAccessible(user);

    // Check if email is verified
    if (!user.emailVerified) {
      throw new ForbiddenException(
        ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
        'Please verify your email address before logging in',
      );
    }

    // Check for new login location and send alert if needed
    const isNewLocation = await this.sessionService.isNewLoginLocation(user._id, ipAddress);
    const deviceInfo = parseUserAgent(userAgent);

    // Fetch user permissions for login response and JWT
    const userRoles = user.roles;
    const [permissions, roleNames] = await Promise.all([
      this.authorizationService.getUserPermissions(userRoles),
      this.authorizationService.getUserRoleNames(userRoles),
    ]);

    // Generate tokens (pass pre-fetched permissions to avoid duplicate DB calls)
    const tokens = await this.sessionService.generateTokens(
      asAuthUser(user),
      ipAddress,
      userAgent,
      permissions,
      roleNames,
    );

    // Update last login
    await this.userService.updateLastLogin(user._id);

    // Ensure the user has a human agent (covers already-registered users on next login)
    await this.humainAgentService.ensureForUser({
      userId: user._id,
      email: user.email,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      role: user.profile.role,
      description: user.profile.description,
    });

    this.logger.log('User logged in', {
      userId: user._id,
      newLocation: isNewLocation,
    });

    // Send new location alert email (async, don't block login)
    if (isNewLocation) {
      this.authEmailService
        .sendNewLocationAlertEmail(user._id, user.email, ipAddress, deviceInfo)
        .catch((err: unknown) => {
          this.logger.warn('Failed to send new location alert email', { error: (err as Error).message });
        });
    }

    return {
      loginResponse: {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user._id,
          email: user.email,
          emailVerified: user.emailVerified,
          profileComplete: user.profileComplete,
          appearance: {
            colorTheme: user.appearance.colorTheme,
            language: user.appearance.language,
          },
          profile: {
            firstName: user.profile.firstName,
            lastName: user.profile.lastName,
            company: user.profile.company,
          },
          consents: {
            privacyPolicy: user.consents.privacyPolicy,
            privacyPolicyAcceptedAt: user.consents.privacyPolicyAcceptedAt,
            dataSharing: user.consents.dataSharing,
            dataSharingAcceptedAt: user.consents.dataSharingAcceptedAt,
          },
          plan: user.planId
            ? {
                id: user.planId,
                slug: user.planSlug,
                startedAt: user.planStartedAt,
              }
            : undefined,
          status: user.status,
          registrationApproval: user.registrationApproval ?? undefined,
          permissions,
          roleNames,
        },
      },
      refreshToken: tokens.refreshToken,
    };
  }

  /** Resend the verification email for an authenticated user. */
  async resendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.userService.generateEmailVerificationToken(userId);
    await this.authEmailService.sendVerificationEmail(userId, email, token);
    this.logger.log('Verification email resent', { userId });
  }

  /**
   * Resend the verification email using the previous verification token
   * (public, no auth).
   */
  async resendVerificationByToken(oldToken: string): Promise<void> {
    const user = await this.userService.findByVerificationToken(oldToken);
    if (!user) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }
    if (user.emailVerified) {
      throw new BadRequestException(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Email is already verified');
    }
    await this.resendVerificationEmail(user._id, user.email);
  }

  /**
   * Handles a forgot-password request.
   * Always succeeds from the caller's perspective to prevent email enumeration.
   */
  async forgotPassword(email: string): Promise<void> {
    const rawToken = await this.userService.generatePasswordResetToken(email);

    if (rawToken) {
      await this.authEmailService.sendPasswordResetEmail(email, rawToken);
    } else {
      this.logger.debug('Forgot password requested for non-existent email');
    }
  }

  /** Reset password with token and invalidate all sessions. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userService.resetPassword(token, newPassword);
    await this.sessionService.invalidateAllUserSessions(user._id);
    this.logger.log('Password reset completed and sessions invalidated', { userId: user._id });
  }
}
