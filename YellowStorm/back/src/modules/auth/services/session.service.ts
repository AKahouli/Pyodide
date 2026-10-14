import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { newObjectId } from '@common/postgres';
import { asAuthUser, type AuthUser } from '@common/auth/auth-user';
import { LoggerService } from '../../logger';
import { AuthorizationService } from '../../authorization/authorization.service';
import { PlatformSettingsService } from '../../system/platform-settings.service';
import { SystemService } from '../../system/system.service';
import {
  DEFAULT_ACCESS_EXPIRY_MS,
  DEFAULT_REFRESH_EXPIRY_MS,
  parseLoginExpiry,
} from '../../system/interfaces/login-settings.interface';
import { UserService } from '../../user/services/user.service';
import { getAccountAccessDenial } from '../../user/utils/assert-account-accessible';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { TokenPair, SessionInfo } from '../interfaces/auth.interface';
import {
  classifySessionStoreError,
  isTransientSessionStoreError,
} from '../utils/session-store-errors';
import { RotationReceiptCrypto } from '../utils/rotation-receipt.crypto';
import { parseUserAgent } from '../utils/device-info';
import { PgSessionStore } from '../persistence/pg-session.store';
import {
  RotationConflictError as StoreRotationConflict,
  type NewSession,
  type RotationBookkeeping,
  type SessionRecord,
} from '../persistence/session.store';

/**
 * Session and token lifecycle for the auth module.
 *
 * Owns everything that persists or rotates refresh-token sessions: issuing a
 * token pair, the atomic refresh rotation, lost-response receipt recovery,
 * reuse detection, session listing/revocation and access-JWT minting. HTTP
 * flows (register/login/…) live in AuthService and delegate here.
 */
@Injectable()
export class SessionService {
  /**
   * How long a standalone claimed-but-unattached rotation window is treated
   * as an in-flight concurrent rotation (retryable conflict) rather than a
   * dead rotation (reuse policy). The attach write lands milliseconds after
   * the claim in the live path.
   */
  private static readonly STANDALONE_CLAIM_GRACE_MS = 30_000;

  private readonly bcryptRounds: number;
  private readonly receiptCrypto: RotationReceiptCrypto;
  private readonly receiptWindowSeconds: number;

  constructor(
    private readonly sessionStore: PgSessionStore,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly authorizationService: AuthorizationService,
    private readonly userService: UserService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly systemService: SystemService,
  ) {
    this.logger.setContext(SessionService.name);
    this.bcryptRounds = this.configService.get<number>('auth.bcryptRounds', 12);
    this.receiptCrypto = new RotationReceiptCrypto(
      this.configService.get<string | undefined>('auth.rotationReceiptKey'),
      this.configService.get<string>('auth.rotationReceiptKeyId', 'receipt-v1'),
    );
    this.receiptWindowSeconds = this.configService.get<number>('auth.rotationReceiptWindowSeconds', 120);
  }

  /**
   * Generate access and refresh tokens.
   * Accepts pre-fetched permissions/roleNames to avoid duplicate DB calls when
   * the caller already has them (e.g. login response includes them).
   */
  async generateTokens(
    user: AuthUser,
    ipAddress: string,
    userAgent: string,
    permissions?: string[],
    roleNames?: string[],
  ): Promise<TokenPair> {
    const tokenFamily = crypto.randomBytes(16).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');

    // Parse device info from user agent
    const deviceInfo = parseUserAgent(userAgent);

    // Calculate refresh token expiry
    const refreshExpiryMs = this.getRefreshTokenExpiryMs();
    const expiresAt = new Date(Date.now() + refreshExpiryMs);

    // Hash refresh token before storing
    const refreshTokenHash = await bcrypt.hash(refreshToken, this.bcryptRounds);

    // Enforce max sessions limit
    await this.enforceSessionLimit(user._id);

    // Create session
    const session = await this.sessionStore.create({
      userId: user._id,
      refreshTokenHash,
      deviceInfo: deviceInfo as unknown as Record<string, unknown>,
      ipAddress,
      expiresAt,
      tokenFamily,
      lastActivityAt: new Date(),
    });

    // Use pre-fetched permissions or fetch fresh ones
    if (!permissions || !roleNames) {
      const userRoles = user.roles;
      [permissions, roleNames] = await Promise.all([
        this.authorizationService.getUserPermissions(userRoles),
        this.authorizationService.getUserRoleNames(userRoles),
      ]);
    }

    // Generate access token with sessionId for immediate revocation support
    const accessPayload = {
      sub: user._id,
      email: user.email,
      type: 'access' as const,
      sessionId: session.id,
      permissions,
      roleNames,
      permissionsVersion: user.permissionsVersion || 1,
    };

    const accessExpiryMs = this.getAccessTokenExpiryMs();
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: Math.floor(accessExpiryMs / 1000),
    });

    return {
      accessToken,
      refreshToken: `${session.id}.${refreshToken}`,
      expiresIn: Math.floor(accessExpiryMs / 1000),
    };
  }

  /**
   * Refresh access token using refresh token.
   *
   * Rotation is atomic: successor creation and predecessor invalidation commit
   * in one transaction guarded by a conditional update on the live
   * predecessor, so concurrent tabs or a lost response can never produce two
   * successors or a half-committed rotation.
   *
   * A rotation whose HTTP response was lost can recover the SAME successor
   * secret within the bounded receipt window by presenting the matching
   * X-Refresh-Attempt-Id plus the still-valid predecessor credential. Outside
   * that window a consumed token follows the existing reuse policy.
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress: string,
    userAgent: string,
    rotationAttemptId?: string,
  ): Promise<TokenPair> {
    const [sessionId, token] = refreshToken.split('.');

    if (!sessionId || !token) {
      throw new UnauthorizedException(
        ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        'Invalid refresh token format',
      );
    }

    // Find session
    const session = await this.sessionStore.findById(sessionId);
    if (!session) {
      throw new UnauthorizedException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'Session not found');
    }

    // Lost-response recovery: same attempt id + matching predecessor credential
    // + unexpired receipt → return the same successor, never rotate again.
    if (rotationAttemptId && session.rotationAttemptId === rotationAttemptId) {
      const recovered = await this.tryRecoverRotationFromReceipt(
        session,
        token,
        rotationAttemptId,
      );
      if (recovered) {
        return recovered;
      }
    }

    // Check if session is valid
    if (!session.isValid) {
      const receiptStillWindowed =
        !!session.rotatedToSessionId &&
        !!session.rotationReceiptExpiresAt &&
        session.rotationReceiptExpiresAt.getTime() > Date.now();

      // Standalone-fallback claimed-but-unattached window: the predecessor was
      // invalidated but the successor link/receipt is not attached yet. A
      // concurrent racer presenting the correct predecessor credential is a
      // legitimate owner, not an attacker — retryable conflict, never family
      // invalidation (which would kill the successor another request already
      // received). A STALE window means the rotating process died mid-rotation
      // and the rotation is unrecoverable: fall through to the reuse policy.
      const claimedButUnattached = !session.rotatedToSessionId && !!session.rotatedAt;
      const claimIsFresh =
        claimedButUnattached &&
        session.rotatedAt !== null &&
        Date.now() - session.rotatedAt.getTime() <
          SessionService.STANDALONE_CLAIM_GRACE_MS;

      if (receiptStillWindowed || claimIsFresh) {
        const predecessorTokenMatches = await bcrypt.compare(token, session.refreshTokenHash);
        if (predecessorTokenMatches) {
          // A concurrent tab or a lost response hit an already-consumed
          // predecessor inside the window: retryable conflict, not reuse.
          // Never hand out the successor secret under a different attempt id.
          this.logger.warn('Refresh rotation conflict on consumed predecessor', {
            userId: session.userId,
            tokenFamily: session.tokenFamily,
            claimedButUnattached,
          });
          throw new ConflictException(
            ErrorCode.AUTH_ROTATION_CONFLICT,
            'Refresh rotation already committed for this session; retry with the original attempt id',
          );
        }
      }

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
      await this.sessionStore.deleteById(session.id);
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
    const user = await this.userService.findById(session.userId);
    if (!user) {
      await this.sessionStore.deleteById(session.id);
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    const accessDenial = getAccountAccessDenial(user.status);
    if (accessDenial) {
      await this.invalidateAllUserSessions(user._id);
      throw new ForbiddenException(accessDenial.code, accessDenial.message);
    }

    // Atomic rotation (expensive hashing happened outside the transaction).
    const { successor, secret } = await this.performAtomicRotation(
      session,
      ipAddress,
      userAgent,
      rotationAttemptId,
    );

    // Get user permissions and role names for JWT
    // Always fetch fresh permissions on token refresh to propagate role changes
    const accessToken = await this.mintAccessTokenForUser(asAuthUser(user), successor.id);

    this.logger.debug('Tokens refreshed', { userId: user._id });

    return {
      accessToken,
      refreshToken: `${successor.id}.${secret}`,
      expiresIn: this.getAccessTokenExpiryMs() / 1000,
    };
  }

  /**
   * Commit successor creation + predecessor invalidation so a double rotation
   * is impossible: the store claims the still-valid predecessor and inserts
   * the successor in ONE transaction (plan 1A.3).
   */
  private async performAtomicRotation(
    session: SessionRecord,
    ipAddress: string,
    userAgent: string,
    rotationAttemptId?: string,
  ): Promise<{ successor: SessionRecord; secret: string }> {
    const secret = crypto.randomBytes(32).toString('hex');
    const deviceInfo = parseUserAgent(userAgent);
    const refreshExpiryMs = this.getRefreshTokenExpiryMs();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + refreshExpiryMs);
    const refreshTokenHash = await bcrypt.hash(secret, this.bcryptRounds);

    // Successor id is app-generated (plan global constraint) so the receipt can
    // seal it before the store's claim links it onto the predecessor.
    const successorId = newObjectId();
    const newSession: NewSession = {
      id: successorId,
      userId: session.userId,
      refreshTokenHash,
      deviceInfo: deviceInfo as unknown as Record<string, unknown>,
      ipAddress,
      expiresAt,
      tokenFamily: session.tokenFamily, // Keep same family for rotation tracking
      lastActivityAt: now,
      rotatedFromSessionId: session.id,
    };
    const bookkeeping = this.buildRotationBookkeeping(session, successorId, secret, now, rotationAttemptId);

    let successor: SessionRecord;
    try {
      successor = await this.sessionStore.rotateAtomic({
        predecessorId: session.id,
        newSession,
        bookkeeping,
      });
    } catch (error) {
      if (error instanceof StoreRotationConflict) {
        this.logger.warn('Concurrent refresh rotation aborted', {
          userId: session.userId,
          tokenFamily: session.tokenFamily,
        });
        throw new ConflictException(
          ErrorCode.AUTH_ROTATION_CONFLICT,
          'Refresh rotation already committed for this session; retry with the original attempt id',
        );
      }
      throw error;
    }
    return { successor, secret };
  }

  /** Predecessor bookkeeping written by the store inside the rotation transaction. */
  private buildRotationBookkeeping(
    session: SessionRecord,
    successorSessionId: string,
    successorSecret: string,
    now: Date,
    rotationAttemptId: string | undefined,
  ): RotationBookkeeping {
    const bookkeeping: RotationBookkeeping = {
      rotatedAt: now,
      rotatedToSessionId: successorSessionId,
    };
    if (rotationAttemptId) {
      bookkeeping.rotationAttemptId = rotationAttemptId;
    }
    if (this.receiptCrypto.isAvailable() && rotationAttemptId) {
      const receiptExpiresAtMs = now.getTime() + this.receiptWindowSeconds * 1000;
      bookkeeping.receipt = {
        expiresAt: new Date(receiptExpiresAtMs),
        keyId: this.receiptCrypto.getKeyId(),
        ciphertext: this.receiptCrypto.seal(successorSecret, {
          predecessorSessionId: session.id,
          successorSessionId,
          tokenFamily: session.tokenFamily,
          rotationAttemptId,
          receiptExpiresAt: receiptExpiresAtMs,
        }),
      };
    }
    return bookkeeping;
  }

  /**
   * Serve the committed successor for a repeated rotation attempt inside the
   * receipt window. Re-evaluates account/permission state; never revives a
   * revoked successor and never extends the receipt or session expiry.
   */
  private async tryRecoverRotationFromReceipt(
    session: SessionRecord,
    presentedToken: string,
    rotationAttemptId: string,
  ): Promise<TokenPair | null> {
    if (
      !session.rotatedToSessionId ||
      !session.rotationReceiptCiphertext ||
      !session.rotationReceiptExpiresAt ||
      session.rotationReceiptExpiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    const predecessorTokenMatches = await bcrypt.compare(presentedToken, session.refreshTokenHash);
    if (!predecessorTokenMatches) {
      return null; // fall through to the reuse-detection policy
    }

    const successor = await this.sessionStore.findById(session.rotatedToSessionId);
    if (!successor || !successor.isValid || successor.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    if (!this.receiptCrypto.isAvailable()) {
      return null;
    }
    const secret = this.receiptCrypto.open(session.rotationReceiptCiphertext, {
      predecessorSessionId: session.id,
      successorSessionId: successor.id,
      tokenFamily: session.tokenFamily,
      rotationAttemptId,
      receiptExpiresAt: session.rotationReceiptExpiresAt.getTime(),
    });
    if (!secret) {
      return null;
    }

    const user = await this.userService.findById(session.userId);
    if (!user) {
      return null;
    }
    const accessDenial = getAccountAccessDenial(user.status);
    if (accessDenial) {
      await this.invalidateAllUserSessions(user._id);
      throw new ForbiddenException(accessDenial.code, accessDenial.message);
    }

    const accessToken = await this.mintAccessTokenForUser(asAuthUser(user), successor.id);
    this.logger.debug('Refresh rotation recovered from receipt', { userId: user._id });
    return {
      accessToken,
      refreshToken: `${successor.id}.${secret}`,
      expiresIn: this.getAccessTokenExpiryMs() / 1000,
    };
  }

  /** Mint an access JWT with fresh permissions for the given session. */
  private async mintAccessTokenForUser(
    user: AuthUser,
    sessionId: string,
  ): Promise<string> {
    const userRoles = user.roles;
    const [permissions, roleNames] = await Promise.all([
      this.authorizationService.getUserPermissions(userRoles),
      this.authorizationService.getUserRoleNames(userRoles),
    ]);

    const accessPayload = {
      sub: user._id,
      email: user.email,
      type: 'access' as const,
      sessionId,
      permissions,
      roleNames,
      permissionsVersion: user.permissionsVersion || 1,
    };

    const accessExpiryMs = this.getAccessTokenExpiryMs();
    return this.jwtService.sign(accessPayload, {
      expiresIn: Math.floor(accessExpiryMs / 1000),
    });
  }

  /** Logout — invalidate the session carried by the refresh token. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const [sessionId] = refreshToken.split('.');
    if (sessionId) {
      await this.sessionStore.invalidateById(sessionId);
      this.logger.debug('User logged out', { sessionId });
    }
  }

  /** Active sessions for the current user, flagging the one in use. */
  async getUserSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
    const sessions = await this.sessionStore.findActiveByUserId(userId);

    return sessions.map((session) => {
      const device = session.deviceInfo as Record<string, string>;
      return {
        id: session.id,
        deviceInfo: {
          userAgent: device.userAgent,
          browser: device.browser,
          browserVersion: device.browserVersion,
          os: device.os,
          osVersion: device.osVersion,
          device: device.device,
          deviceType: device.deviceType,
        },
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt ?? undefined,
        isCurrent: session.id === currentSessionId,
      };
    });
  }

  /** Invalidate one specific session owned by the user. */
  async invalidateSession(userId: string, sessionId: string): Promise<void> {
    const matched = await this.sessionStore.invalidateByIdAndUser(userId, sessionId);

    if (!matched) {
      throw new NotFoundException(ErrorCode.AUTH_SESSION_NOT_FOUND, 'Session not found');
    }

    this.logger.log('Session invalidated', { userId, sessionId });
  }

  /** Invalidate every session for a user (password reset, re-use, suspension). */
  async invalidateAllUserSessions(userId: string): Promise<void> {
    await this.sessionStore.invalidateAllForUser(userId);

    this.logger.log('All sessions invalidated', { userId });
  }

  /** True when this (user, ip) pair has no prior session (new-location check). */
  async isNewLoginLocation(userId: string, ipAddress: string): Promise<boolean> {
    return !(await this.sessionStore.existsForUserAndIp(userId, ipAddress));
  }

  getAccessTokenExpiryMs(): number {
    return parseLoginExpiry(this.systemService.getLoginSettingsSync().accessExpiry)
      ?? DEFAULT_ACCESS_EXPIRY_MS;
  }

  getRefreshTokenExpiryMs(): number {
    return parseLoginExpiry(this.systemService.getLoginSettingsSync().refreshExpiry)
      ?? DEFAULT_REFRESH_EXPIRY_MS;
  }

  /** Extract session ID from a `sessionId.secret` refresh token. */
  extractSessionIdFromToken(refreshToken: string): string | null {
    const [sessionId] = refreshToken.split('.');
    return sessionId || null;
  }

  /**
   * Validate if a session is still active (for access token validation).
   * Returns true if session exists and is valid, false only for an
   * authoritatively missing/invalid/expired session.
   *
   * A transient session-store failure throws ServiceUnavailableException
   * (AUTH_DEPENDENCY_UNAVAILABLE) — it is never reported as a revoked session,
   * so callers must let the typed exception propagate to a 503 instead of
   * treating it as an authentication denial.
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    let session: SessionRecord | null;
    try {
      session = await this.sessionStore.findById(sessionId);
    } catch (error) {
      const errorClass = classifySessionStoreError(error);
      if (isTransientSessionStoreError(error)) {
        this.logger.error('Session store unavailable during session validation', {
          sessionId,
          errorClass,
        });
        throw new ServiceUnavailableException(
          ErrorCode.AUTH_DEPENDENCY_UNAVAILABLE,
          'Session store is temporarily unavailable',
        );
      }
      // Unexpected driver/programming error: not proof of revocation either.
      // Rethrow so the global filter reports an internal error (ERR_1000).
      this.logger.error('Unexpected session store failure during session validation', {
        sessionId,
        errorClass,
      });
      throw error;
    }

    if (!session) {
      return false;
    }
    return session.isValid && session.expiresAt > new Date();
  }

  /** Invalidate all sessions in a token family (for reuse detection). */
  private async invalidateTokenFamily(tokenFamily: string): Promise<void> {
    await this.sessionStore.invalidateByFamily(tokenFamily);
  }

  /**
   * Enforce maximum sessions per user limit: keep the newest `max - 1` valid
   * sessions so the one about to be created fits under the cap.
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    const { auth } = await this.platformSettings.getSettings();
    const invalidated = await this.sessionStore.invalidateOldestBeyond(
      userId,
      auth.maxSessionsPerUser - 1,
    );

    if (invalidated > 0) {
      this.logger.debug('Oldest sessions invalidated due to limit', {
        userId,
        count: invalidated,
      });
    }
  }
}
