import { randomBytes } from 'crypto';
import { HttpStatus, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import {
  appDataApps,
  appDataEndUsers,
  type AppDataAppRow,
  type AppDataEndUserRow,
} from '@modules/postgres/schema/app-data.schema';
import { ConversationV2AppShareService } from '@modules/conversation-v2/services/conversation-v2-app-share.service';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type { AppDataEndUserJwtPayload } from '../constants/app-data.types';
import { AppDataAuditService } from './app-data-audit.service';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataEndUserGrantsService } from './app-data-end-user-grants.service';
import { AppDataEndUserService } from './app-data-end-user.service';

/** Dummy hash so missing-user logins still pay bcrypt cost (timing). */
const LOGIN_DUMMY_HASH = bcrypt.hashSync('__app_data_timing_dummy__', 4);

export interface AppEndUserAuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

@Injectable()
export class AppDataEndUserAuthService {
  private readonly logger = new Logger(AppDataEndUserAuthService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly catalog: AppDataCatalogService,
    private readonly endUsers: AppDataEndUserService,
    private readonly grants: AppDataEndUserGrantsService,
    private readonly audit: AppDataAuditService,
    @Inject(forwardRef(() => ConversationV2AppShareService))
    private readonly appShares: ConversationV2AppShareService,
  ) {}

  isEndUserAuthGloballyEnabled(): boolean {
    return this.config.get<boolean>('appData.endUserAuthEnabled', true);
  }

  isEndUserAuthEnabledForApp(app: AppDataAppRow): boolean {
    return this.isEndUserAuthGloballyEnabled() && app.endUserAuthEnabled;
  }

  async ensureJwtSecret(app: AppDataAppRow): Promise<string> {
    if (app.jwtSecret) {
      return app.jwtSecret;
    }
    const secret = randomBytes(32).toString('hex');
    await this.db
      .update(appDataApps)
      .set({ jwtSecret: secret, updatedAt: new Date() })
      .where(eq(appDataApps.id, app.id));
    return secret;
  }

  extractBearerToken(authorization: string | undefined): string | null {
    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }
    const token = authorization.slice('Bearer '.length).trim();
    return token || null;
  }

  async verifyToken(app: AppDataAppRow, token: string): Promise<AppDataEndUserJwtPayload> {
    const secret = await this.ensureJwtSecret(app);
    let payload: AppDataEndUserJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<AppDataEndUserJwtPayload>(token, { secret });
    } catch {
      throw new AppDataException(
        AppDataErrorCode.AUTH_INVALID,
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (payload.typ !== 'app_end_user' || payload.appDataId !== app.appDataId || !payload.sub) {
      throw new AppDataException(
        AppDataErrorCode.AUTH_INVALID,
        'Invalid token payload',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return payload;
  }

  async resolveEndUserFromRequest(
    app: AppDataAppRow,
    authorization: string | undefined,
  ): Promise<AppDataEndUserRow> {
    const token = this.extractBearerToken(authorization);
    if (!token) {
      throw new AppDataException(
        AppDataErrorCode.AUTH_REQUIRED,
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const payload = await this.verifyToken(app, token);
    const user = await this.endUsers.findById(app.id, payload.sub);
    if (!user) {
      throw new AppDataException(
        AppDataErrorCode.AUTH_INVALID,
        'User not found',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status === 'disabled') {
      throw new AppDataException(
        AppDataErrorCode.USER_DISABLED,
        'User account is disabled',
        HttpStatus.FORBIDDEN,
      );
    }
    return user;
  }

  private jwtExpiresInSeconds(): number {
    const ttl = this.config.get<string>('appData.endUserJwtTtl', '7d');
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) return 7 * 24 * 60 * 60;
    const value = Number(match[1]);
    switch (match[2]) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
      default:
        return value * 24 * 60 * 60;
    }
  }

  private async signToken(app: AppDataAppRow, user: AppDataEndUserRow): Promise<string> {
    const secret = await this.ensureJwtSecret(app);
    const payload: AppDataEndUserJwtPayload = {
      sub: user.id,
      appDataId: app.appDataId,
      typ: 'app_end_user',
    };
    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: this.jwtExpiresInSeconds(),
    });
  }

  private toAuthResult(token: string, user: AppDataEndUserRow): AppEndUserAuthResult {
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }

  async resolveInvite(
    appDataId: string,
    token: string,
  ): Promise<{ email: string; appTitle: string; expiresAt: string }> {
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const invite = await this.requireValidInvite(app, token);
    return {
      email: invite.email,
      appTitle: invite.appTitle,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async register(params: {
    appDataId: string;
    email: string;
    password: string;
    displayName?: string;
    inviteToken?: string;
  }): Promise<AppEndUserAuthResult> {
    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    if (!this.isEndUserAuthEnabledForApp(app)) {
      throw new AppDataException(
        AppDataErrorCode.DISABLED,
        'End-user authentication is disabled for this app',
      );
    }

    const inviteToken = params.inviteToken?.trim() || undefined;
    let email = this.endUsers.normalizeEmail(params.email);
    if (inviteToken) {
      const invite = await this.requireValidInvite(app, inviteToken);
      if (email !== invite.email) {
        throw new AppDataException(
          AppDataErrorCode.INVITE_MISMATCH,
          'Invite email does not match',
          HttpStatus.FORBIDDEN,
        );
      }
      email = invite.email;
    }

    if (!email || !params.password || params.password.length < 8) {
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        'Valid email and password (min 8 characters) are required',
      );
    }

    const existing = await this.endUsers.findByEmail(app.id, email);
    if (existing) {
      throw new AppDataException(
        AppDataErrorCode.EMAIL_TAKEN,
        'Email is already registered',
        HttpStatus.CONFLICT,
      );
    }

    const rounds = this.config.get<number>('appData.endUserBcryptRounds', 12);
    const passwordHash = await bcrypt.hash(params.password, rounds);

    const [user] = await this.db
      .insert(appDataEndUsers)
      .values({
        appId: app.id,
        email,
        passwordHash,
        displayName: params.displayName?.trim() || null,
        status: 'active',
      })
      .returning();

    await this.grants.seedDenyAll(app.id, user.id);

    let inviteConsumed = false;
    if (inviteToken) {
      inviteConsumed = await this.appShares.consumeInviteToken(inviteToken, email);
      if (!inviteConsumed) {
        this.logger.warn(`Invite consume failed after register for app ${app.appDataId}`);
      }
    }

    await this.audit.record({
      appId: app.id,
      eventType: inviteToken ? 'invite_register' : 'end_user_register',
      actorPrincipal: 'anonymous',
      metadata: { userId: user.id, email, inviteConsumed },
    });

    const token = await this.signToken(app, user);
    return this.toAuthResult(token, user);
  }

  async login(params: {
    appDataId: string;
    email: string;
    password: string;
  }): Promise<AppEndUserAuthResult> {
    const app = await this.catalog.requireAppByAppDataId(params.appDataId);
    if (!this.isEndUserAuthEnabledForApp(app)) {
      throw new AppDataException(
        AppDataErrorCode.DISABLED,
        'End-user authentication is disabled for this app',
      );
    }

    const email = this.endUsers.normalizeEmail(params.email);
    const user = await this.endUsers.findByEmail(app.id, email);
    if (!user) {
      // Timing-safe dummy hash to prevent user enumeration via timing.
      await bcrypt.compare(params.password, LOGIN_DUMMY_HASH);
      await this.audit.record({
        appId: app.id,
        eventType: 'login_failed',
        actorPrincipal: 'anonymous',
        metadata: { email, reason: 'user_not_found' },
      });
      throw new AppDataException(
        AppDataErrorCode.AUTH_INVALID,
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status === 'disabled') {
      await this.audit.record({
        appId: app.id,
        eventType: 'login_failed',
        actorPrincipal: 'anonymous',
        metadata: { email, userId: user.id, reason: 'account_disabled' },
      });
      throw new AppDataException(
        AppDataErrorCode.USER_DISABLED,
        'User account is disabled',
        HttpStatus.FORBIDDEN,
      );
    }

    const rounds = this.config.get<number>('appData.endUserBcryptRounds', 12);
    const valid = await bcrypt.compare(params.password, user.passwordHash);
    if (!valid) {
      await this.audit.record({
        appId: app.id,
        eventType: 'login_failed',
        actorPrincipal: 'anonymous',
        metadata: { email, userId: user.id, reason: 'invalid_password' },
      });
      throw new AppDataException(
        AppDataErrorCode.AUTH_INVALID,
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = await this.signToken(app, user);
    return this.toAuthResult(token, user);
  }

  async me(appDataId: string, authorization: string | undefined): Promise<AppEndUserAuthResult['user']> {
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const user = await this.resolveEndUserFromRequest(app, authorization);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }

  private async requireValidInvite(app: AppDataAppRow, token: string) {
    const invite = await this.appShares.resolveInviteToken(token);
    if (!invite) {
      throw new AppDataException(
        AppDataErrorCode.INVITE_INVALID,
        'Invite token is invalid',
        HttpStatus.NOT_FOUND,
      );
    }
    if (invite.consumed) {
      throw new AppDataException(
        AppDataErrorCode.INVITE_CONSUMED,
        'Invite token has already been used',
        HttpStatus.GONE,
      );
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new AppDataException(
        AppDataErrorCode.INVITE_EXPIRED,
        'Invite token has expired',
        HttpStatus.GONE,
      );
    }
    if (!invite.workspaceId || invite.workspaceId !== app.workspaceId) {
      throw new AppDataException(
        AppDataErrorCode.INVITE_MISMATCH,
        'Invite does not belong to this app',
        HttpStatus.FORBIDDEN,
      );
    }
    return invite;
  }
}
