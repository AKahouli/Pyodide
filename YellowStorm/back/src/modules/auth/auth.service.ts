import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UAParser } from 'ua-parser-js';
import { Session, SessionDocument } from './schemas/session.schema';
import { UserService } from '../user/user.service';
import { UserDocument, UserStatus } from '../user/schemas/user.schema';
import { LoggerService } from '../logger';
import { EmailService } from '../email';
import { UsageService } from '../usage';
import { AuthorizationService } from '../authorization/authorization.service';
import { SystemService } from '../system/system.service';
import { WorkspaceInitializerService } from '../workspace/workspace-initializer.service';
import { TokenPair, LoginResponse, DeviceInfoData, SessionInfo } from './interfaces/auth.interface';
import { BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly bcryptRounds: number;
  private readonly accessExpiry: string;
  private readonly refreshExpiry: string;
  private readonly maxSessionsPerUser: number;
  private readonly appName: string;
  private readonly frontendUrl: string;
  private readonly passwordResetExpiryHours: number;

  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => UsageService))
    private readonly usageService: UsageService,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    private readonly systemService: SystemService,
    @Inject(forwardRef(() => WorkspaceInitializerService))
    private readonly workspaceInitializer: WorkspaceInitializerService,
  ) {
    this.logger.setContext(AuthService.name);
    this.bcryptRounds = this.configService.get<number>('auth.bcryptRounds', 12);
    this.accessExpiry = this.configService.get<string>('jwt.accessExpiry', '15m');
    this.refreshExpiry = this.configService.get<string>('jwt.refreshExpiry', '7d');
    this.maxSessionsPerUser = this.configService.get<number>('auth.maxSessionsPerUser', 10);
    this.appName = this.configService.get<string>('app.name', 'YelloStorm');
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
    this.passwordResetExpiryHours = this.configService.get<number>('auth.passwordResetExpiry', 1);
  }

  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<{ message: string; userId: string }> {
    if (!this.systemService.isRegistrationEnabled()) {
      throw new ForbiddenException(
        ErrorCode.REGISTRATION_DISABLED,
        'User registration is currently disabled.',
      );
    }

    const user = await this.userService.create({
      email: dto.email,
      password: dto.password,
    });
    // Assign default (free) plan to new user
    let defaultPlan;
    try {
      defaultPlan = await this.usageService.getDefaultPlan();
      await this.userService.assignPlan(
        user._id.toString(),
        defaultPlan._id as Types.ObjectId,
        defaultPlan.slug,
      );
      this.logger.log('Default plan assigned to user', {
        userId: user._id,
        planSlug: defaultPlan.slug,
      });
    } catch (error) {
      // Log but don't fail registration if plan assignment fails
      this.logger.warn('Failed to assign default plan to user', {
        userId: user._id,
        error: (error as Error).message,
      });
    }

    // Create personal workspace for the new user
    try {
      const workspaceStorage = defaultPlan?.workspaceStorageBytes ?? 100 * 1024 * 1024; // 100MB default
      await this.workspaceInitializer.getOrCreatePersonalWorkspace(
        user._id.toString(),
        workspaceStorage,
      );
      this.logger.log('Personal workspace created for new user', {
        userId: user._id,
      });
    } catch (error) {
      // Log but don't fail registration if workspace creation fails
      this.logger.warn('Failed to create personal workspace for user', {
        userId: user._id,
        error: (error as Error).message,
      });
    }

    this.logger.log('User registered', { userId: user._id, email: user.email });

    // Send verification email
    await this.sendVerificationEmail(user.email, user.emailVerificationToken!);

    return {
      message: 'Registration successful. Please check your email to verify your account.',
      userId: user._id.toString(),
    };
  }

  /**
   * Login with email and password
   */
  async login(
    dto: LoginDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ loginResponse: LoginResponse; refreshToken: string }> {
    // Find user
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    // Check if account is suspended
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(ErrorCode.AUTH_ACCOUNT_SUSPENDED, 'Account is suspended');
    }

    // Validate password
    const isPasswordValid = await this.userService.validatePassword(user, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    // Check if email is verified
    if (!user.emailVerified) {
      throw new ForbiddenException(
        ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
        'Please verify your email address before logging in',
      );
    }

    // Check for new login location and send alert if needed
    const isNewLocation = await this.checkNewLoginLocation(user._id, ipAddress);
    const deviceInfo = this.parseUserAgent(userAgent);

    // Fetch user permissions for login response and JWT
    const userRoles = user.roles || [];
    const [permissions, roleNames] = await Promise.all([
      this.authorizationService.getUserPermissions(userRoles),
      this.authorizationService.getUserRoleNames(userRoles),
    ]);

    // Generate tokens (pass pre-fetched permissions to avoid duplicate DB calls)
    const tokens = await this.generateTokens(user, ipAddress, userAgent, permissions, roleNames);

    // Update last login
    await this.userService.updateLastLogin(user._id.toString());

    this.logger.log('User logged in', {
      userId: user._id,
      email: user.email,
      newLocation: isNewLocation,
    });

    // Send new location alert email (async, don't block login)
    if (isNewLocation) {
      this.sendNewLocationAlertEmail(user.email, ipAddress, deviceInfo).catch((err) => {
        this.logger.warn('Failed to send new location alert email', { error: err.message });
      });
    }

    return {
      loginResponse: {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user._id.toString(),
          email: user.email,
          emailVerified: user.emailVerified,
          profileComplete: user.profileComplete,
          profile: {
            firstName: user.profile?.firstName,
            lastName: user.profile?.lastName,
            company: user.profile?.company,
          },
          consents: {
            privacyPolicy: user.consents?.privacyPolicy,
            privacyPolicyAcceptedAt: user.consents?.privacyPolicyAcceptedAt,
            dataSharing: user.consents?.dataSharing,
            dataSharingAcceptedAt: user.consents?.dataSharingAcceptedAt,
          },
          plan: user.planId
            ? {
                id: user.planId.toString(),
                slug: user.planSlug,
                startedAt: user.planStartedAt,
              }
            : undefined,
          status: user.status,
          permissions,
          roleNames,
        },
      },
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Generate access and refresh tokens
   * Accepts pre-fetched permissions/roleNames to avoid duplicate DB calls when
   * the caller already has them (e.g. login response includes them).
   */
  async generateTokens(
    user: UserDocument,
    ipAddress: string,
    userAgent: string,
    permissions?: string[],
    roleNames?: string[],
  ): Promise<TokenPair> {
    const tokenFamily = crypto.randomBytes(16).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');

    // Parse device info from user agent
    const deviceInfo = this.parseUserAgent(userAgent);

    // Calculate refresh token expiry
    const refreshExpiryMs = this.parseExpiryToMs(this.refreshExpiry);
    const expiresAt = new Date(Date.now() + refreshExpiryMs);

    // Hash refresh token before storing
    const refreshTokenHash = await bcrypt.hash(refreshToken, this.bcryptRounds);

    // Enforce max sessions limit
    await this.enforceSessionLimit(user._id);

    // Create session
    const session = new this.sessionModel({
      userId: user._id,
      refreshTokenHash,
      deviceInfo,
      ipAddress,
      expiresAt,
      tokenFamily,
      lastActivityAt: new Date(),
    });
    await session.save();

    // Use pre-fetched permissions or fetch fresh ones
    if (!permissions || !roleNames) {
      const userRoles = user.roles || [];
      [permissions, roleNames] = await Promise.all([
        this.authorizationService.getUserPermissions(userRoles),
        this.authorizationService.getUserRoleNames(userRoles),
      ]);
    }

    // Generate access token with sessionId for immediate revocation support
    const accessPayload = {
      sub: user._id.toString(),
      email: user.email,
      type: 'access' as const,
      sessionId: session._id.toString(),
      permissions,
      roleNames,
      permissionsVersion: user.permissionsVersion || 1,
    };

    const accessExpiryMs = this.parseExpiryToMs(this.accessExpiry);
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: Math.floor(accessExpiryMs / 1000),
    });

    return {
      accessToken,
      refreshToken: `${session._id.toString()}.${refreshToken}`,
      expiresIn: Math.floor(accessExpiryMs / 1000),
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<TokenPair> {
    const [sessionId, token] = refreshToken.split('.');

    if (!sessionId || !token) {
      throw new UnauthorizedException(
        ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        'Invalid refresh token format',
      );
    }

    // Find session
    const session = await this.sessionModel.findById(sessionId);
    if (!session) {
      throw new UnauthorizedException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'Session not found');
    }

    // Check if session is valid
    if (!session.isValid) {
      // Potential token reuse attack - invalidate all sessions in this family
      await this.invalidateTokenFamily(session.tokenFamily);
      this.logger.warn('Potential token reuse detected', {
        userId: session.userId,
        tokenFamily: session.tokenFamily,
      });
      throw new UnauthorizedException(
        ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        'Session has been invalidated',
      );
    }

    // Check if token is expired
    if (session.expiresAt < new Date()) {
      await this.sessionModel.deleteOne({ _id: session._id });
      throw new UnauthorizedException(
        ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED,
        'Refresh token has expired',
      );
    }

    // Verify refresh token hash
    const isTokenValid = await bcrypt.compare(token, session.refreshTokenHash);
    if (!isTokenValid) {
      // Token mismatch - potential attack
      await this.invalidateTokenFamily(session.tokenFamily);
      throw new UnauthorizedException(
        ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        'Invalid refresh token',
      );
    }

    // Get user
    const user = await this.userService.findById(session.userId.toString());
    if (!user) {
      await this.sessionModel.deleteOne({ _id: session._id });
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    if (user.status === UserStatus.SUSPENDED) {
      await this.invalidateAllUserSessions(user._id.toString());
      throw new ForbiddenException(ErrorCode.AUTH_ACCOUNT_SUSPENDED, 'Account is suspended');
    }

    // Invalidate old session (token rotation)
    session.isValid = false;
    await session.save();

    // Generate new tokens with same token family
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const deviceInfo = this.parseUserAgent(userAgent);
    const refreshExpiryMs = this.parseExpiryToMs(this.refreshExpiry);
    const expiresAt = new Date(Date.now() + refreshExpiryMs);
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, this.bcryptRounds);

    // Create new session in same family
    const newSession = new this.sessionModel({
      userId: user._id,
      refreshTokenHash: newRefreshTokenHash,
      deviceInfo,
      ipAddress,
      expiresAt,
      tokenFamily: session.tokenFamily, // Keep same family for rotation tracking
      lastActivityAt: new Date(),
    });
    await newSession.save();

    // Get user permissions and role names for JWT
    // Always fetch fresh permissions on token refresh to propagate role changes
    const userRoles = user.roles || [];
    const [permissions, roleNames] = await Promise.all([
      this.authorizationService.getUserPermissions(userRoles),
      this.authorizationService.getUserRoleNames(userRoles),
    ]);

    // Generate new access token with sessionId for immediate revocation support
    const accessPayload = {
      sub: user._id.toString(),
      email: user.email,
      type: 'access' as const,
      sessionId: newSession._id.toString(),
      permissions,
      roleNames,
      permissionsVersion: user.permissionsVersion || 1,
    };

    const accessExpiryMs = this.parseExpiryToMs(this.accessExpiry);
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: Math.floor(accessExpiryMs / 1000),
    });

    this.logger.debug('Tokens refreshed', { userId: user._id });

    return {
      accessToken,
      refreshToken: `${newSession._id.toString()}.${newRefreshToken}`,
      expiresIn: Math.floor(accessExpiryMs / 1000),
    };
  }

  /**
   * Logout - invalidate current session
   */
  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const [sessionId] = refreshToken.split('.');
    if (sessionId) {
      await this.sessionModel.updateOne({ _id: sessionId }, { $set: { isValid: false } });
      this.logger.debug('User logged out', { sessionId });
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
    const sessions = await this.sessionModel
      .find({
        userId: new Types.ObjectId(userId),
        isValid: true,
        expiresAt: { $gt: new Date() },
      })
      .sort({ lastActivityAt: -1 });

    return sessions.map((session) => ({
      id: session._id.toString(),
      deviceInfo: {
        userAgent: session.deviceInfo.userAgent,
        browser: session.deviceInfo.browser,
        browserVersion: session.deviceInfo.browserVersion,
        os: session.deviceInfo.os,
        osVersion: session.deviceInfo.osVersion,
        device: session.deviceInfo.device,
        deviceType: session.deviceInfo.deviceType,
      },
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      isCurrent: session._id.toString() === currentSessionId,
    }));
  }

  /**
   * Invalidate a specific session
   */
  async invalidateSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.sessionModel.updateOne(
      { _id: sessionId, userId: new Types.ObjectId(userId) },
      { $set: { isValid: false } },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException(ErrorCode.AUTH_SESSION_NOT_FOUND, 'Session not found');
    }

    this.logger.log('Session invalidated', { userId, sessionId });
  }

  /**
   * Invalidate all sessions for a user
   */
  async invalidateAllUserSessions(userId: string): Promise<void> {
    await this.sessionModel.updateMany(
      { userId: new Types.ObjectId(userId) },
      { $set: { isValid: false } },
    );

    this.logger.log('All sessions invalidated', { userId });
  }

  /**
   * Parse user agent string to device info
   */
  private parseUserAgent(userAgent: string): DeviceInfoData {
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    return {
      userAgent,
      browser: result.browser.name,
      browserVersion: result.browser.version,
      os: result.os.name,
      osVersion: result.os.version,
      device: result.device.model,
      deviceType: result.device.type || 'desktop',
    };
  }

  /**
   * Invalidate all sessions in a token family (for reuse detection)
   */
  private async invalidateTokenFamily(tokenFamily: string): Promise<void> {
    await this.sessionModel.updateMany({ tokenFamily }, { $set: { isValid: false } });
  }

  /**
   * Enforce maximum sessions per user limit
   */
  private async enforceSessionLimit(userId: Types.ObjectId): Promise<void> {
    const sessionCount = await this.sessionModel.countDocuments({
      userId,
      isValid: true,
      expiresAt: { $gt: new Date() },
    });

    if (sessionCount >= this.maxSessionsPerUser) {
      // Remove oldest sessions
      const oldestSessions = await this.sessionModel
        .find({ userId, isValid: true })
        .sort({ lastActivityAt: 1 })
        .limit(sessionCount - this.maxSessionsPerUser + 1);

      const sessionIds = oldestSessions.map((s) => s._id);
      await this.sessionModel.updateMany(
        { _id: { $in: sessionIds } },
        { $set: { isValid: false } },
      );

      this.logger.debug('Oldest sessions invalidated due to limit', {
        userId,
        count: sessionIds.length,
      });
    }
  }

  /**
   * Parse expiry string to milliseconds
   */
  private parseExpiryToMs(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 15 * 60 * 1000; // Default 15 minutes
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 15 * 60 * 1000;
    }
  }

  /**
   * Extract session ID from refresh token
   */
  extractSessionIdFromToken(refreshToken: string): string | null {
    const [sessionId] = refreshToken.split('.');
    return sessionId || null;
  }

  /**
   * Validate if a session is still active (for access token validation)
   * Returns true if session exists and is valid, false otherwise
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    try {
      const session = await this.sessionModel.findById(sessionId);
      if (!session) {
        return false;
      }
      return session.isValid && session.expiresAt > new Date();
    } catch {
      return false;
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.userService.generateEmailVerificationToken(userId);
    await this.sendVerificationEmail(email, token);
    this.logger.log('Verification email resent', { userId, email });
  }

  /**
   * Resend verification email using the previous verification token (public, no auth)
   */
  async resendVerificationByToken(oldToken: string): Promise<void> {
    const user = await this.userService.findByVerificationToken(oldToken);
    if (!user) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }
    if (user.emailVerified) {
      throw new BadRequestException(ErrorCode.EMAIL_ALREADY_VERIFIED, 'Email is already verified');
    }
    await this.resendVerificationEmail(user._id.toString(), user.email);
  }

  /**
   * Handle forgot password request
   * Always succeeds from the caller's perspective to prevent email enumeration
   */
  async forgotPassword(email: string): Promise<void> {
    const rawToken = await this.userService.generatePasswordResetToken(email);

    if (rawToken) {
      await this.sendPasswordResetEmail(email, rawToken);
    } else {
      this.logger.debug('Forgot password requested for non-existent email', { email });
    }
  }

  /**
   * Reset password with token and invalidate all sessions
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userService.resetPassword(token, newPassword);
    await this.invalidateAllUserSessions(user._id.toString());
    this.logger.log('Password reset completed and sessions invalidated', { userId: user._id });
  }

  /**
   * Send password reset email
   */
  private async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping password reset email');
      return;
    }

    const resetUrl = `${this.frontendUrl}/#/reset-password?token=${token}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${this.appName}</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">Reset Your Password</h2>
    <p>We received a request to reset your password for your ${this.appName} account. Click the button below to set a new password:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
    </div>
    <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #667eea; font-size: 14px; word-break: break-all;">${resetUrl}</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">This link will expire in ${this.passwordResetExpiryHours} hour${this.passwordResetExpiryHours > 1 ? 's' : ''}. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.</p>
  </div>
</body>
</html>`;

    const text = `
Reset Your Password

We received a request to reset your password for your ${this.appName} account. Click the link below to set a new password:

${resetUrl}

This link will expire in ${this.passwordResetExpiryHours} hour${this.passwordResetExpiryHours > 1 ? 's' : ''}. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.
`;

    const result = await this.emailService.send({
      to: email,
      subject: `Reset your password - ${this.appName}`,
      html,
      text,
      priority: 'high',
    });

    if (!result.success) {
      this.logger.error('Failed to send password reset email', { email, error: result.error });
    }
  }

  /**
   * Check if login is from a new location (IP address)
   */
  private async checkNewLoginLocation(userId: Types.ObjectId, ipAddress: string): Promise<boolean> {
    // Check if this IP has been used before for this user
    const existingSession = await this.sessionModel.findOne({
      userId,
      ipAddress,
    });

    return !existingSession;
  }

  /**
   * Send verification email
   */
  private async sendVerificationEmail(email: string, token: string): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping verification email');
      return;
    }

    const verificationUrl = `${this.frontendUrl}/#/verify-email?token=${token}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${this.appName}</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">Verify Your Email Address</h2>
    <p>Thank you for registering with ${this.appName}. Please click the button below to verify your email address:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Verify Email</a>
    </div>
    <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #667eea; font-size: 14px; word-break: break-all;">${verificationUrl}</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">This link will expire in 24 hours. If you didn't create an account with ${this.appName}, you can safely ignore this email.</p>
  </div>
</body>
</html>`;

    const text = `
Verify Your Email Address

Thank you for registering with ${this.appName}. Please click the link below to verify your email address:

${verificationUrl}

This link will expire in 24 hours. If you didn't create an account with ${this.appName}, you can safely ignore this email.
`;

    const result = await this.emailService.send({
      to: email,
      subject: `Verify your email address - ${this.appName}`,
      html,
      text,
    });

    if (!result.success) {
      this.logger.error('Failed to send verification email', { email, error: result.error });
    }
  }

  /**
   * Send new login location alert email
   */
  private async sendNewLocationAlertEmail(
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

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Login Alert</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${this.appName} Security Alert</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #f5576c; margin-top: 0;">🔔 New Login Detected</h2>
    <p>We noticed a new sign-in to your ${this.appName} account from a location we haven't seen before.</p>

    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 100px;">Time:</td>
          <td style="padding: 8px 0; font-weight: 500;">${loginTime}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">IP Address:</td>
          <td style="padding: 8px 0; font-weight: 500;">${ipAddress}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Device:</td>
          <td style="padding: 8px 0; font-weight: 500;">${deviceDescription || 'Unknown device'}</td>
        </tr>
      </table>
    </div>

    <p><strong>Was this you?</strong></p>
    <p>If you recognize this login, you can ignore this email. If you don't recognize this activity, we recommend you:</p>
    <ul style="color: #666;">
      <li>Change your password immediately</li>
      <li>Review your active sessions in account settings</li>
      <li>Enable additional security measures if available</li>
    </ul>

    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">This is an automated security notification from ${this.appName}. If you have any concerns, please contact our support team.</p>
  </div>
</body>
</html>`;

    const text = `
New Login Alert - ${this.appName}

We noticed a new sign-in to your ${this.appName} account from a location we haven't seen before.

Login Details:
- Time: ${loginTime}
- IP Address: ${ipAddress}
- Device: ${deviceDescription || 'Unknown device'}

Was this you?

If you recognize this login, you can ignore this email. If you don't recognize this activity, we recommend you:
- Change your password immediately
- Review your active sessions in account settings
- Enable additional security measures if available

This is an automated security notification from ${this.appName}. If you have any concerns, please contact our support team.
`;

    const result = await this.emailService.send({
      to: email,
      subject: `🔔 New login to your ${this.appName} account`,
      html,
      text,
      priority: 'high',
    });

    if (!result.success) {
      this.logger.error('Failed to send new location alert email', { email, error: result.error });
    } else {
      this.logger.log('New location alert email sent', { email, ipAddress });
    }
  }
}
