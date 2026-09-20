import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoggerService } from '../logger';
import {
  CreateUserData,
  UpdateUserData,
  CompleteProfileData,
} from './interfaces/user.interface';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { HumainAgentService } from '../humain-agent/humain-agent.service';
import { RegistrationApprovalService } from './registration-approval.service';
import { USER_STORE, type UserPatch, type UserRecord, type UserStore } from './persistence/user.store';
import { toUserDoc, type UserDocLike } from './persistence/user-record.mapper';

interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface UserSummary {
  id: string;
  email: string;
}

interface SearchUsersParams {
  query: string;
  excludeUserId?: string;
  limit?: number;
}

const REGISTRATION_PENDING = 'pending';
const APPROVAL_APPROVED = 'approved';

@Injectable()
export class UserService {
  private readonly bcryptRounds = 12;
  private readonly passwordResetExpiryHours: number;

  constructor(
    @Inject(USER_STORE) private readonly userStore: UserStore,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly humainAgentService: HumainAgentService,
    private readonly registrationApprovalService: RegistrationApprovalService,
  ) {
    this.logger.setContext(UserService.name);
    this.passwordResetExpiryHours = this.configService.get<number>('auth.passwordResetExpiry', 1);
  }

  /**
   * Create a new user
   */
  async create(data: CreateUserData): Promise<UserDocLike> {
    if (await this.userStore.existsByEmail(data.email)) {
      throw new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, this.bcryptRounds);
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await this.userStore.create({
      email: data.email.toLowerCase(),
      passwordHash,
      emailVerified: data.emailVerified || false,
      ...(data.emailVerified ? {} : { emailVerificationToken, emailVerificationExpiry }),
      firstName: data.profile?.firstName ?? undefined,
      lastName: data.profile?.lastName ?? undefined,
      company: data.profile?.company ?? undefined,
      profileRole: data.profile?.role ?? '',
      description: data.profile?.description ?? '',
      microsoftAccountId: data.microsoftAccountId,
      status: 'inactive',
      registrationApproval: REGISTRATION_PENDING,
    });

    this.logger.log('User created', { userId: user.id, email: user.email });
    return toUserDoc(user);
  }

  /**
   * Create a new OAuth user with a random unusable password hash.
   * The user's email is considered verified (provider-verified).
   */
  async createOAuthUser(data: {
    email: string;
    profile?: { firstName?: string; lastName?: string };
  }): Promise<UserDocLike> {
    if (await this.userStore.existsByEmail(data.email)) {
      throw new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered');
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, this.bcryptRounds);

    const user = await this.userStore.create({
      email: data.email.toLowerCase(),
      passwordHash,
      emailVerified: true,
      profileComplete: false,
      firstName: data.profile?.firstName ?? undefined,
      lastName: data.profile?.lastName ?? undefined,
    });

    this.logger.log('OAuth user created', { userId: user.id, email: user.email });
    return toUserDoc(user);
  }

  /** Find user by ID */
  async findById(id: string): Promise<UserDocLike | null> {
    const record = await this.userStore.findById(id);
    return record ? toUserDoc(record) : null;
  }

  async findSummaryById(id: string): Promise<UserSummary | null> {
    const record = await this.userStore.findById(id);
    return record ? { id: record.id, email: record.email } : null;
  }

  /** Find user by email */
  async findByEmail(email: string): Promise<UserDocLike | null> {
    const record = await this.userStore.findByEmail(email);
    return record ? toUserDoc(record) : null;
  }

  /** Find user by email with sensitive fields (for auth). Store records always carry them. */
  async findByEmailWithSensitiveFields(email: string): Promise<UserDocLike | null> {
    return this.findByEmail(email);
  }

  /** Find user by Microsoft account ID */
  async findByMicrosoftAccountId(microsoftAccountId: string): Promise<UserDocLike | null> {
    const record = await this.userStore.findByMicrosoftAccountId(microsoftAccountId);
    return record ? toUserDoc(record) : null;
  }

  /** Validate password */
  async validatePassword(user: UserDocLike, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  /** Update user profile */
  async updateProfile(userId: string, data: UpdateUserData): Promise<UserDocLike> {
    const current = await this.userStore.findById(userId);
    if (!current) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    const patch: UserPatch = {};
    if (data.profile) {
      patch.firstName = data.profile.firstName ?? current.firstName;
      patch.lastName = data.profile.lastName ?? current.lastName;
      patch.company = data.profile.company ?? current.company;
      patch.profileRole = data.profile.role ?? current.profileRole;
      patch.description = data.profile.description ?? current.description;
    }
    if (data.appearance) {
      patch.colorTheme = data.appearance.colorTheme ?? current.colorTheme;
      patch.language = data.appearance.language ?? current.language;
    }
    if (data.consents) {
      const now = new Date();
      if (data.consents.privacyPolicy !== undefined) {
        patch.consentPrivacyPolicy = data.consents.privacyPolicy;
        patch.consentPrivacyPolicyAcceptedAt = data.consents.privacyPolicy ? now : current.consentPrivacyPolicyAcceptedAt;
      }
      if (data.consents.dataSharing !== undefined) {
        patch.consentDataSharing = data.consents.dataSharing;
        patch.consentDataSharingAcceptedAt = data.consents.dataSharing ? now : current.consentDataSharingAcceptedAt;
      }
    }

    const updated = await this.userStore.update(userId, patch);
    if (!updated) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    this.logger.log('User profile updated', { userId });

    if (data.profile) {
      await this.humainAgentService.syncFromProfile({
        userId,
        email: updated.email,
        firstName: updated.firstName ?? undefined,
        lastName: updated.lastName ?? undefined,
        role: updated.profileRole,
        description: updated.description,
      });
    }

    return toUserDoc(updated);
  }

  /** Complete user profile (required fields + consents) */
  async completeProfile(userId: string, data: CompleteProfileData): Promise<UserDocLike> {
    const current = await this.userStore.findById(userId);
    if (!current) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (!data.privacyPolicy) {
      throw new BadRequestException('Privacy policy must be accepted');
    }

    const shouldNotifySuperAdmins =
      !current.profileComplete && current.registrationApproval === REGISTRATION_PENDING;

    const now = new Date();
    const patch: UserPatch = {
      firstName: data.firstName,
      lastName: data.lastName,
      company: data.company,
      profileRole: data.role ?? current.profileRole ?? '',
      description: data.description ?? current.description ?? '',
      consentPrivacyPolicy: data.privacyPolicy,
      consentPrivacyPolicyAcceptedAt: now,
      consentDataSharing: data.dataSharing,
      consentDataSharingAcceptedAt: data.dataSharing ? now : current.consentDataSharingAcceptedAt,
      profileComplete: true,
    };
    const updated = await this.userStore.update(userId, patch);
    if (!updated) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    this.logger.log('User profile completed', { userId });

    await this.humainAgentService.syncFromProfile({
      userId,
      email: updated.email,
      firstName: updated.firstName ?? undefined,
      lastName: updated.lastName ?? undefined,
      role: updated.profileRole,
      description: updated.description,
    });

    // The super admin registration notice must be sent only once the applicant
    // has completed and validated their profile (not at sign-up).
    if (shouldNotifySuperAdmins) {
      try {
        await this.registrationApprovalService.notifySuperAdminsOfRegistration({
          userId,
          email: updated.email,
          requestedAt: updated.createdAt,
        });
      } catch (error) {
        this.logger.warn('Failed to notify super admins of completed registration', {
          userId,
          error: (error as Error).message,
        });
      }
    }

    return toUserDoc(updated);
  }

  /** Verify email with token */
  async verifyEmail(token: string): Promise<UserDocLike> {
    const user = await this.userStore.findByVerificationToken(token);
    if (!user) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }

    if (user.emailVerified) {
      throw new BadRequestException(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Email is already verified');
    }

    if (user.emailVerificationExpiry && user.emailVerificationExpiry < new Date()) {
      throw new BadRequestException(ErrorCode.VERIFICATION_TOKEN_EXPIRED, 'Verification token has expired');
    }

    // Keep emailVerificationToken so the token can still identify the user for resend
    const updated = await this.userStore.update(user.id, { emailVerified: true, emailVerificationExpiry: null });
    if (!updated) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    this.logger.log('Email verified', { userId: user.id });
    return toUserDoc(updated);
  }

  /** Find user by verification token (for public resend endpoint) */
  async findByVerificationToken(token: string): Promise<UserDocLike | null> {
    const record = await this.userStore.findByVerificationToken(token);
    return record ? toUserDoc(record) : null;
  }

  /** Generate new email verification token */
  async generateEmailVerificationToken(userId: string): Promise<string> {
    const user = await this.userStore.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Email is already verified');
    }

    const token = crypto.randomBytes(32).toString('hex');
    await this.userStore.update(userId, {
      emailVerificationToken: token,
      emailVerificationExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return token;
  }

  /** Update last login timestamp */
  async updateLastLogin(userId: string): Promise<void> {
    await this.userStore.update(userId, { lastLoginAt: new Date() });
  }

  /** Link Microsoft account to user */
  async linkMicrosoftAccount(userId: string, microsoftAccountId: string): Promise<UserDocLike> {
    // Check if Microsoft account is already linked to another user
    const existing = await this.userStore.findByMicrosoftAccountId(microsoftAccountId);
    if (existing && existing.id !== userId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Microsoft account is already linked to another user');
    }

    if (!(await this.userStore.findById(userId))) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    const updated = await this.userStore.update(userId, { microsoftAccountId });
    if (!updated) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    this.logger.log('Microsoft account linked', { userId });
    return toUserDoc(updated);
  }

  /** Check if email is available */
  async isEmailAvailable(email: string): Promise<boolean> {
    return !(await this.userStore.existsByEmail(email));
  }

  /** Suspend user account */
  async suspendUser(userId: string): Promise<void> {
    await this.userStore.update(userId, { status: 'suspended' });
    this.logger.log('User suspended', { userId });
  }

  /** Activate user account */
  async activateUser(userId: string): Promise<void> {
    await this.userStore.update(userId, { status: 'active' });
    this.logger.log('User activated', { userId });
  }

  /** Assign a plan to a user */
  async assignPlan(userId: string, planId: Types.ObjectId, planSlug: string): Promise<UserDocLike> {
    const updated = await this.userStore.update(userId, {
      planId: String(planId),
      planSlug,
      planStartedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    this.logger.log('Plan assigned to user', { userId, planSlug });
    return toUserDoc(updated);
  }

  /** Generate a password reset token for a user. Returns null if user not found (prevents email enumeration). */
  async generatePasswordResetToken(email: string): Promise<string | null> {
    const user = await this.userStore.findByEmail(email);
    if (!user) {
      return null;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.userStore.update(user.id, {
      passwordResetToken: hashedToken,
      passwordResetExpiry: new Date(Date.now() + this.passwordResetExpiryHours * 60 * 60 * 1000),
    });

    this.logger.log('Password reset token generated', { userId: user.id });
    return rawToken;
  }

  /** Reset password using a valid reset token */
  async resetPassword(rawToken: string, newPassword: string): Promise<UserDocLike> {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const user = await this.userStore.findByResetTokenHash(hashedToken);
    if (!user) {
      throw new BadRequestException(ErrorCode.AUTH_RESET_TOKEN_INVALID, 'Invalid or already used password reset token');
    }

    if (user.passwordResetExpiry && user.passwordResetExpiry < new Date()) {
      await this.userStore.update(user.id, { passwordResetToken: null, passwordResetExpiry: null });
      throw new BadRequestException(ErrorCode.AUTH_RESET_TOKEN_EXPIRED, 'Password reset token has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);
    const updated = await this.userStore.update(user.id, {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiry: null,
    });
    if (!updated) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    this.logger.log('Password reset successfully', { userId: user.id });
    return toUserDoc(updated);
  }

  /** Get users without a plan (for migration/assignment) */
  async getUsersWithoutPlan(limit = 100): Promise<UserDocLike[]> {
    const records = await this.userStore.findWithoutPlan(limit);
    return records.map((record) => toUserDoc(record));
  }

  /** Search active users by name or email (case-insensitive). */
  async searchUsers(params: SearchUsersParams): Promise<UserSearchResult[]> {
    const { query, excludeUserId, limit = 10 } = params;
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 3) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Search query must contain at least 3 characters');

    const hits = await this.userStore.searchActive(normalizedQuery, { excludeUserId, limit });
    return hits.map((h) => ({ ...h, firstName: h.firstName ?? undefined, lastName: h.lastName ?? undefined }));
  }

  async listActiveUsers(excludeUserId?: string, limit = 50): Promise<UserSearchResult[]> {
    const hits = await this.userStore.listActive({ excludeUserId, limit });
    return hits.map((h) => ({ ...h, firstName: h.firstName ?? undefined, lastName: h.lastName ?? undefined }));
  }
}

/** Re-exported for consumers that annotate the doc shape explicitly. */
export type { UserDocLike };
export type { UserRecord };
