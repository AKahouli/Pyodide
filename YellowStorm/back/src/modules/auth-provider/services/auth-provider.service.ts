import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthProvider, AuthProviderDocument } from '../schemas/auth-provider.schema';
import { UserProviderLink, UserProviderLinkDocument } from '../schemas/user-provider-link.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { SystemService } from '@modules/system/system.service';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateAuthProviderDto } from '../dto/create-auth-provider.dto';
import { UpdateAuthProviderDto } from '../dto/update-auth-provider.dto';
import { UpdateClassicAuthDto } from '../dto/update-classic-auth.dto';
import {
  AuthProviderPublicResponse,
  AuthProviderAdminResponse,
  DecryptedProviderConfig,
} from '../interfaces/auth-provider.interface';

@Injectable()
export class AuthProviderService {
  constructor(
    @InjectModel(AuthProvider.name)
    private readonly authProviderModel: Model<AuthProviderDocument>,
    @InjectModel(UserProviderLink.name)
    private readonly userProviderLinkModel: Model<UserProviderLinkDocument>,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
    private readonly systemService: SystemService,
  ) {
    this.logger.setContext(AuthProviderService.name);
  }

  /**
   * List all providers with secrets masked (admin view).
   * Prepends classic email/password as a virtual provider.
   */
  async findAll(): Promise<AuthProviderAdminResponse[]> {
    const providers = await this.authProviderModel
      .find()
      .sort({ sortOrder: 1, displayName: 1 })
      .lean()
      .exec();

    const responses = await Promise.all(
      providers.map(async (p) => {
        const linkedUserCount = await this.userProviderLinkModel.countDocuments({
          providerKey: p.providerKey,
        });
        return this.toAdminResponse(p, linkedUserCount);
      }),
    );

    // Prepend classic auth virtual provider
    const classicProvider = this.buildClassicAdminResponse();
    return [classicProvider, ...responses];
  }

  /**
   * List enabled providers — public, no secrets.
   * Includes classic email/password as a virtual provider (sortOrder: 999 → renders last).
   */
  async findEnabled(): Promise<AuthProviderPublicResponse[]> {
    const providers = await this.authProviderModel
      .find({ enabled: true })
      .sort({ sortOrder: 1, displayName: 1 })
      .lean()
      .exec();

    const oauthProviders: AuthProviderPublicResponse[] = providers.map((p) => ({
      type: 'oauth' as const,
      providerKey: p.providerKey,
      displayName: p.displayName,
      iconKey: p.iconKey || p.providerKey,
      sortOrder: p.sortOrder,
    }));

    // Only include classic provider if classic auth is enabled
    if (!this.systemService.isClassicAuthEnabled()) {
      return oauthProviders;
    }

    const classicProvider: AuthProviderPublicResponse = {
      type: 'classic',
      providerKey: 'classic',
      displayName: 'Email & Password',
      iconKey: 'email',
      sortOrder: 999,
      registrationEnabled: this.systemService.isRegistrationEnabled(),
    };

    return [...oauthProviders, classicProvider];
  }

  /**
   * Find provider by key — decrypts secrets (internal use only).
   */
  async findByKey(providerKey: string): Promise<DecryptedProviderConfig> {
    const provider = await this.authProviderModel
      .findOne({ providerKey: providerKey.toLowerCase() })
      .lean()
      .exec();

    if (!provider) {
      throw new NotFoundException(
        ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND,
        `Provider '${providerKey}' not found`,
      );
    }

    if (!provider.enabled) {
      throw new BadRequestException(
        ErrorCode.AUTH_OAUTH_PROVIDER_DISABLED,
        `Provider '${providerKey}' is disabled`,
      );
    }

    return {
      providerKey: provider.providerKey,
      displayName: provider.displayName,
      clientId: this.cryptoService.decrypt(provider.clientId),
      clientSecret: this.cryptoService.decrypt(provider.clientSecret),
      tenantId: provider.tenantId ? this.cryptoService.decrypt(provider.tenantId) : undefined,
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userinfoUrl: provider.userinfoUrl,
      scopes: provider.scopes,
      pkceEnabled: provider.pkceEnabled,
      enabled: provider.enabled,
    };
  }

  /**
   * Find provider by ID (admin view, masked).
   */
  async findById(id: string): Promise<AuthProviderAdminResponse> {
    const provider = await this.authProviderModel.findById(id).lean().exec();
    if (!provider) {
      throw new NotFoundException(ErrorCode.AUTH_PROVIDER_NOT_FOUND, 'Provider not found');
    }
    const linkedUserCount = await this.userProviderLinkModel.countDocuments({
      providerKey: provider.providerKey,
    });
    return this.toAdminResponse(provider, linkedUserCount);
  }

  /**
   * Create a new provider (admin).
   */
  async create(dto: CreateAuthProviderDto): Promise<AuthProviderAdminResponse> {
    // Check uniqueness
    const existing = await this.authProviderModel.findOne({
      providerKey: dto.providerKey.toLowerCase(),
    });
    if (existing) {
      throw new ConflictException(
        ErrorCode.AUTH_PROVIDER_ALREADY_EXISTS,
        `Provider '${dto.providerKey}' already exists`,
      );
    }

    const provider = new this.authProviderModel({
      providerKey: dto.providerKey.toLowerCase(),
      displayName: dto.displayName,
      clientId: this.cryptoService.encrypt(dto.clientId),
      clientSecret: this.cryptoService.encrypt(dto.clientSecret),
      tenantId: dto.tenantId ? this.cryptoService.encrypt(dto.tenantId) : undefined,
      authorizationUrl: dto.authorizationUrl,
      tokenUrl: dto.tokenUrl,
      userinfoUrl: dto.userinfoUrl,
      scopes: dto.scopes ?? ['openid', 'email', 'profile'],
      iconKey: dto.iconKey,
      sortOrder: dto.sortOrder ?? 0,
      pkceEnabled: dto.pkceEnabled ?? true,
      enabled: dto.enabled ?? true,
    });

    await provider.save();

    this.logger.log('Auth provider created', { providerKey: provider.providerKey });

    return this.toAdminResponse(provider.toObject());
  }

  /**
   * Update a provider (admin). Preserves secrets if masked values sent.
   */
  async update(id: string, dto: UpdateAuthProviderDto): Promise<AuthProviderAdminResponse> {
    const provider = await this.authProviderModel.findById(id);
    if (!provider) {
      throw new NotFoundException(ErrorCode.AUTH_PROVIDER_NOT_FOUND, 'Provider not found');
    }

    // Check uniqueness if providerKey is changing
    if (dto.providerKey && dto.providerKey.toLowerCase() !== provider.providerKey) {
      const existing = await this.authProviderModel.findOne({
        providerKey: dto.providerKey.toLowerCase(),
      });
      if (existing) {
        throw new ConflictException(
          ErrorCode.AUTH_PROVIDER_ALREADY_EXISTS,
          `Provider '${dto.providerKey}' already exists`,
        );
      }
      provider.providerKey = dto.providerKey.toLowerCase();
    }

    if (dto.displayName !== undefined) provider.displayName = dto.displayName;
    if (dto.authorizationUrl !== undefined) provider.authorizationUrl = dto.authorizationUrl;
    if (dto.tokenUrl !== undefined) provider.tokenUrl = dto.tokenUrl;
    if (dto.userinfoUrl !== undefined) provider.userinfoUrl = dto.userinfoUrl;
    if (dto.scopes !== undefined) provider.scopes = dto.scopes;
    if (dto.iconKey !== undefined) provider.iconKey = dto.iconKey;
    if (dto.sortOrder !== undefined) provider.sortOrder = dto.sortOrder;
    if (dto.pkceEnabled !== undefined) provider.pkceEnabled = dto.pkceEnabled;
    if (dto.enabled !== undefined) provider.enabled = dto.enabled;

    // Only re-encrypt secrets if actual new values are provided (not masked)
    if (dto.clientId && dto.clientId !== '****') {
      provider.clientId = this.cryptoService.encrypt(dto.clientId);
    }
    if (dto.clientSecret && dto.clientSecret !== '****') {
      provider.clientSecret = this.cryptoService.encrypt(dto.clientSecret);
    }
    if (dto.tenantId !== undefined) {
      if (dto.tenantId && dto.tenantId !== '****') {
        provider.tenantId = this.cryptoService.encrypt(dto.tenantId);
      } else if (dto.tenantId === '') {
        provider.tenantId = undefined;
      }
      // If '****', keep existing value
    }

    await provider.save();

    this.logger.log('Auth provider updated', { providerKey: provider.providerKey });

    return this.toAdminResponse(provider.toObject());
  }

  /**
   * Delete a provider config. Optionally removes user-provider links.
   * When links are preserved, re-adding the provider with the same key
   * lets users login again without re-linking.
   */
  async delete(id: string, deleteLinks = false): Promise<{ unlinkedUsers: number }> {
    const provider = await this.authProviderModel.findById(id);
    if (!provider) {
      throw new NotFoundException(ErrorCode.AUTH_PROVIDER_NOT_FOUND, 'Provider not found');
    }

    let unlinkedUsers = 0;

    if (deleteLinks) {
      const result = await this.userProviderLinkModel.deleteMany({
        providerKey: provider.providerKey,
      });
      unlinkedUsers = result.deletedCount;
    }

    await this.authProviderModel.deleteOne({ _id: id });

    this.logger.log('Auth provider deleted', {
      providerKey: provider.providerKey,
      deleteLinks,
      unlinkedUsers,
    });

    return { unlinkedUsers };
  }

  /**
   * Get the number of users linked to a provider.
   */
  async getLinkedUserCount(providerKey: string): Promise<number> {
    return this.userProviderLinkModel.countDocuments({ providerKey });
  }

  /**
   * Get classic auth admin response (virtual provider).
   */
  getClassicAuthAdmin(): AuthProviderAdminResponse {
    return this.buildClassicAdminResponse();
  }

  /**
   * Update classic auth settings (enable/disable + registration toggle).
   * Delegates to SystemService as the source of truth.
   */
  async updateClassicAuth(
    dto: UpdateClassicAuthDto,
    userId?: string,
  ): Promise<AuthProviderAdminResponse> {
    if (dto.enabled !== undefined) {
      await this.systemService.setClassicAuthEnabled(dto.enabled, { userId });
      this.logger.log('Classic auth toggled', {
        enabled: dto.enabled,
        userId,
      });
    }

    if (dto.registrationEnabled !== undefined) {
      await this.systemService.setRegistrationEnabled(dto.registrationEnabled, { userId });
      this.logger.log('Classic auth registration updated', {
        registrationEnabled: dto.registrationEnabled,
        userId,
      });
    }

    return this.buildClassicAdminResponse();
  }

  /**
   * Build the virtual classic auth admin response from SystemService state.
   */
  private buildClassicAdminResponse(): AuthProviderAdminResponse {
    const registrationEnabled = this.systemService.isRegistrationEnabled();
    const classicAuthEnabled = this.systemService.isClassicAuthEnabled();
    const now = new Date();
    return {
      type: 'classic',
      id: 'classic',
      providerKey: 'classic',
      displayName: 'Email & Password',
      clientId: '',
      clientSecret: '',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: '',
      scopes: [],
      iconKey: 'email',
      sortOrder: 999,
      pkceEnabled: false,
      enabled: classicAuthEnabled,
      linkedUserCount: 0,
      registrationEnabled,
      createdAt: now,
      updatedAt: now,
    };
  }

  private toAdminResponse(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: any,
    linkedUserCount = 0,
  ): AuthProviderAdminResponse {
    return {
      type: 'oauth',
      id: (p._id || p.id).toString(),
      providerKey: p.providerKey,
      displayName: p.displayName,
      clientId: '****',
      clientSecret: '****',
      tenantId: p.tenantId ? '****' : undefined,
      authorizationUrl: p.authorizationUrl,
      tokenUrl: p.tokenUrl,
      userinfoUrl: p.userinfoUrl,
      scopes: p.scopes,
      iconKey: p.iconKey,
      sortOrder: p.sortOrder,
      pkceEnabled: p.pkceEnabled,
      enabled: p.enabled,
      linkedUserCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
