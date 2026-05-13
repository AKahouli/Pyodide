import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument, UserStatus } from './schemas/user.schema';
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
import { escapeRegex } from '../../common/utils';

interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface SearchUsersParams {
  query: string;
  excludeUserId?: string;
  limit?: number;
}

@Injectable()
export class UserService {
  private readonly bcryptRounds = 12;
  private readonly passwordResetExpiryHours: number;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(UserService.name);
    this.passwordResetExpiryHours = this.configService.get<number>('auth.passwordResetExpiry', 1);
  }

  /**
   * Create a new user
   */
  async create(data: CreateUserData): Promise<UserDocument> {
    // Check if email already exists
    const existingUser = await this.userModel.findOne({ email: data.email.toLowerCase() });
    if (existingUser) {
      throw new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, this.bcryptRounds);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = new this.userModel({
      email: data.email.toLowerCase(),
      passwordHash,
      emailVerified: data.emailVerified || false,
      emailVerificationToken: data.emailVerified ? undefined : emailVerificationToken,
      emailVerificationExpiry: data.emailVerified ? undefined : emailVerificationExpiry,
      profile: data.profile || {},
      microsoftAccountId: data.microsoftAccountId,
    });

    await user.save();

    this.logger.log('User created', { userId: user._id, email: user.email });

    return user;
  }

  /**
   * Create a new OAuth user with a random unusable password hash.
   * The user's email is considered verified (provider-verified).
   */
  async createOAuthUser(data: {
    email: string;
    profile?: { firstName?: string; lastName?: string };
  }): Promise<UserDocument> {
    const existingUser = await this.userModel.findOne({ email: data.email.toLowerCase() });
    if (existingUser) {
      throw new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered');
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, this.bcryptRounds);

    const user = new this.userModel({
      email: data.email.toLowerCase(),
      passwordHash,
      emailVerified: true,
      profileComplete: false,
      profile: data.profile || {},
    });

    await user.save();

    this.logger.log('OAuth user created', { userId: user._id, email: user.email });

    return user;
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id);
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  /**
   * Find user by email with sensitive fields (for auth)
   */
  async findByEmailWithSensitiveFields(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+emailVerificationToken +passwordResetToken');
  }

  /**
   * Find user by Microsoft account ID
   */
  async findByMicrosoftAccountId(microsoftAccountId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ microsoftAccountId });
  }

  /**
   * Validate password
   */
  async validatePassword(user: UserDocument, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: UpdateUserData): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (data.profile) {
      user.profile = { ...user.profile, ...data.profile };
    }
    if (data.appearance) {
      user.appearance = { ...user.appearance, ...data.appearance };
    }
    if (data.consents) {
      const now = new Date();
      if (data.consents.privacyPolicy !== undefined) {
        user.consents.privacyPolicy = data.consents.privacyPolicy;
        if (data.consents.privacyPolicy) {
          user.consents.privacyPolicyAcceptedAt = now;
        }
      }
      if (data.consents.dataSharing !== undefined) {
        user.consents.dataSharing = data.consents.dataSharing;
        if (data.consents.dataSharing) {
          user.consents.dataSharingAcceptedAt = now;
        }
      }
    }

    await user.save();

    this.logger.log('User profile updated', { userId });

    return user;
  }

  /**
   * Complete user profile (required fields + consents)
   */
  async completeProfile(userId: string, data: CompleteProfileData): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (!data.privacyPolicy) {
      throw new BadRequestException('Privacy policy must be accepted');
    }

    const now = new Date();

    user.profile.firstName = data.firstName;
    user.profile.lastName = data.lastName;
    user.profile.company = data.company;
    user.consents.privacyPolicy = data.privacyPolicy;
    user.consents.privacyPolicyAcceptedAt = now;
    user.consents.dataSharing = data.dataSharing;
    if (data.dataSharing) {
      user.consents.dataSharingAcceptedAt = now;
    }
    user.profileComplete = true;

    await user.save();

    this.logger.log('User profile completed', { userId });

    return user;
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<UserDocument> {
    const user = await this.userModel
      .findOne({ emailVerificationToken: token })
      .select('+emailVerificationToken');

    if (!user) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }

    if (user.emailVerified) {
      throw new BadRequestException(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Email is already verified');
    }

    if (user.emailVerificationExpiry && user.emailVerificationExpiry < new Date()) {
      throw new BadRequestException(ErrorCode.VERIFICATION_TOKEN_EXPIRED, 'Verification token has expired');
    }

    user.emailVerified = true;
    user.emailVerificationExpiry = undefined;
    // Keep emailVerificationToken so the token can still identify the user for resend

    await user.save();

    this.logger.log('Email verified', { userId: user._id });

    return user;
  }

  /**
   * Find user by verification token (for public resend endpoint)
   */
  async findByVerificationToken(token: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ emailVerificationToken: token })
      .select('+emailVerificationToken');
  }

  /**
   * Generate new email verification token
   */
  async generateEmailVerificationToken(userId: string): Promise<string> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Email is already verified');
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await user.save();

    return token;
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { lastLoginAt: new Date() } },
    );
  }

  /**
   * Link Microsoft account to user
   */
  async linkMicrosoftAccount(
    userId: string,
    microsoftAccountId: string,
  ): Promise<UserDocument> {
    // Check if Microsoft account is already linked to another user
    const existingUser = await this.userModel.findOne({ microsoftAccountId });
    if (existingUser && existingUser._id.toString() !== userId) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Microsoft account is already linked to another user',
      );
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    user.microsoftAccountId = microsoftAccountId;
    await user.save();

    this.logger.log('Microsoft account linked', { userId });

    return user;
  }

  /**
   * Check if email is available
   */
  async isEmailAvailable(email: string): Promise<boolean> {
    const count = await this.userModel.countDocuments({ email: email.toLowerCase() });
    return count === 0;
  }

  /**
   * Suspend user account
   */
  async suspendUser(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { status: UserStatus.SUSPENDED } },
    );
    this.logger.log('User suspended', { userId });
  }

  /**
   * Activate user account
   */
  async activateUser(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { status: UserStatus.ACTIVE } },
    );
    this.logger.log('User activated', { userId });
  }

  /**
   * Assign a plan to a user
   */
  async assignPlan(
    userId: string,
    planId: Types.ObjectId,
    planSlug: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    user.planId = planId;
    user.planSlug = planSlug;
    user.planStartedAt = new Date();

    await user.save();

    this.logger.log('Plan assigned to user', { userId, planSlug });

    return user;
  }

  /**
   * Generate a password reset token for a user
   * Returns null if user not found (prevents email enumeration)
   */
  async generatePasswordResetToken(email: string): Promise<string | null> {
    const user = await this.userModel.findOne({ email: email.toLowerCase() });
    if (!user) {
      return null;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.passwordResetToken = hashedToken;
    user.passwordResetExpiry = new Date(Date.now() + this.passwordResetExpiryHours * 60 * 60 * 1000);
    await user.save();

    this.logger.log('Password reset token generated', { userId: user._id });

    return rawToken;
  }

  /**
   * Reset password using a valid reset token
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<UserDocument> {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const user = await this.userModel
      .findOne({ passwordResetToken: hashedToken })
      .select('+passwordResetToken');

    if (!user) {
      throw new BadRequestException(ErrorCode.AUTH_RESET_TOKEN_INVALID, 'Invalid or already used password reset token');
    }

    if (user.passwordResetExpiry && user.passwordResetExpiry < new Date()) {
      user.passwordResetToken = undefined;
      user.passwordResetExpiry = undefined;
      await user.save();
      throw new BadRequestException(ErrorCode.AUTH_RESET_TOKEN_EXPIRED, 'Password reset token has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);
    user.passwordHash = passwordHash;
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    await user.save();

    this.logger.log('Password reset successfully', { userId: user._id });

    return user;
  }

  /**
   * Get users without a plan (for migration/assignment)
   */
  async getUsersWithoutPlan(limit = 100): Promise<UserDocument[]> {
    return this.userModel
      .find({ planId: { $exists: false } })
      .limit(limit)
      .exec();
  }

  /**
   * Search active users by email prefix (case-insensitive).
   * Returns minimal user info for sharing/autocomplete purposes.
   */
  async searchUsers(params: SearchUsersParams): Promise<UserSearchResult[]> {
    const { query, excludeUserId, limit = 10 } = params;

    const emailRegex = new RegExp(`^${escapeRegex(query)}`, 'i');

    const filter: Record<string, unknown> = { email: emailRegex, status: UserStatus.ACTIVE };
    if (excludeUserId) {
      filter._id = { $ne: new Types.ObjectId(excludeUserId) };
    }

    const users = await this.userModel
      .find(filter)
      .select('email profile.firstName profile.lastName')
      .limit(limit)
      .exec();

    return users.map((user) => ({
      id: user._id.toString(),
      email: user.email,
      firstName: user.profile?.firstName,
      lastName: user.profile?.lastName,
    }));
  }
}
