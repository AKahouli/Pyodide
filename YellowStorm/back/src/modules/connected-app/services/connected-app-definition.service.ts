import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConnectedAppDefinition,
  ConnectedAppDefinitionDocument,
} from '../schemas/connected-app-definition.schema';
import { UserAppConnection, UserAppConnectionDocument } from '../schemas/user-app-connection.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { collapseRepeatedChar, collapseWhitespace } from '@common/utils';
import { CreateConnectedAppDefinitionDto, DEFAULT_COMMON_APP_KEYS } from '../dto/create-connected-app-definition.dto';
import { UpdateConnectedAppDefinitionDto } from '../dto/update-connected-app-definition.dto';
import {
  ConnectedAppAdminResponse,
  ConnectedAppPublicResponse,
  DecryptedAppConfig,
} from '../interfaces/connected-app.interface';

@Injectable()
export class ConnectedAppDefinitionService {
  constructor(
    @InjectModel(ConnectedAppDefinition.name)
    private readonly definitionModel: Model<ConnectedAppDefinitionDocument>,
    @InjectModel(UserAppConnection.name)
    private readonly connectionModel: Model<UserAppConnectionDocument>,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppDefinitionService.name);
  }

  async findAllEnabled(): Promise<ConnectedAppPublicResponse[]> {
    const definitions = await this.definitionModel
      .find({ enabled: true })
      .sort({ sortOrder: 1, displayName: 1 })
      .lean()
      .exec();

    return definitions.map((d) => ({
      appKey: d.appKey,
      displayName: d.displayName,
      description: d.description,
      iconKey: d.iconKey,
      scopes: d.scopes,
      sortOrder: d.sortOrder,
    }));
  }

  async findAll(): Promise<ConnectedAppAdminResponse[]> {
    const definitions = await this.definitionModel
      .find()
      .sort({ sortOrder: 1, displayName: 1 })
      .lean()
      .exec();

    return Promise.all(
      definitions.map(async (d) => {
        const connectedUserCount = await this.connectionModel.countDocuments({
          appKey: d.appKey,
        });
        return this.toAdminResponse(d, connectedUserCount);
      }),
    );
  }

  async findByKey(appKey: string): Promise<DecryptedAppConfig> {
    const definition = await this.definitionModel
      .findOne({ appKey: appKey.toLowerCase() })
      .lean()
      .exec();

    if (!definition) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_NOT_FOUND,
        `Connected app '${appKey}' not found`,
      );
    }

    if (!definition.enabled) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_DISABLED,
        `Connected app '${appKey}' is disabled`,
      );
    }

    return {
      appKey: definition.appKey,
      displayName: definition.displayName,
      description: definition.description,
      clientId: this.cryptoService.decrypt(definition.clientId),
      clientSecret: this.cryptoService.decrypt(definition.clientSecret),
      tenantId: definition.tenantId ? this.cryptoService.decrypt(definition.tenantId) : undefined,
      authorizationUrl: definition.authorizationUrl,
      tokenUrl: definition.tokenUrl,
      revokeUrl: definition.revokeUrl,
      scopes: definition.scopes,
      pkceEnabled: definition.pkceEnabled,
      enabled: definition.enabled,
    };
  }

  async findById(id: string): Promise<ConnectedAppAdminResponse> {
    const definition = await this.definitionModel.findById(id).lean().exec();
    if (!definition) {
      throw new NotFoundException(ErrorCode.CONNECTED_APP_NOT_FOUND, 'Connected app not found');
    }
    const connectedUserCount = await this.connectionModel.countDocuments({
      appKey: definition.appKey,
    });
    return this.toAdminResponse(definition, connectedUserCount);
  }

  async create(dto: CreateConnectedAppDefinitionDto): Promise<ConnectedAppAdminResponse> {
    const existing = await this.definitionModel.findOne({
      appKey: dto.appKey.toLowerCase(),
    });
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONNECTED_APP_ALREADY_EXISTS,
        `Connected app '${dto.appKey}' already exists`,
      );
    }

    const definition = new this.definitionModel({
      appKey: dto.appKey.toLowerCase(),
      displayName: dto.displayName,
      description: dto.description,
      iconKey: dto.iconKey,
      authorizationUrl: dto.authorizationUrl,
      tokenUrl: dto.tokenUrl,
      revokeUrl: dto.revokeUrl,
      clientId: this.cryptoService.encrypt(dto.clientId),
      clientSecret: this.cryptoService.encrypt(dto.clientSecret),
      tenantId: dto.tenantId ? this.cryptoService.encrypt(dto.tenantId) : undefined,
      scopes: dto.scopes,
      pkceEnabled: dto.pkceEnabled ?? true,
      enabled: dto.enabled ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });

    await definition.save();

    this.logger.log('Connected app definition created', { appKey: definition.appKey });

    return this.toAdminResponse(definition.toObject());
  }

  async update(
    id: string,
    dto: UpdateConnectedAppDefinitionDto,
  ): Promise<ConnectedAppAdminResponse> {
    const definition = await this.definitionModel.findById(id);
    if (!definition) {
      throw new NotFoundException(ErrorCode.CONNECTED_APP_NOT_FOUND, 'Connected app not found');
    }

    if (dto.appKey && dto.appKey.toLowerCase() !== definition.appKey) {
      const existing = await this.definitionModel.findOne({
        appKey: dto.appKey.toLowerCase(),
      });
      if (existing) {
        throw new ConflictException(
          ErrorCode.CONNECTED_APP_ALREADY_EXISTS,
          `Connected app '${dto.appKey}' already exists`,
        );
      }
      definition.appKey = dto.appKey.toLowerCase();
    }

    if (dto.displayName !== undefined) definition.displayName = dto.displayName;
    if (dto.description !== undefined) definition.description = dto.description;
    if (dto.iconKey !== undefined) definition.iconKey = dto.iconKey;
    if (dto.authorizationUrl !== undefined) definition.authorizationUrl = dto.authorizationUrl;
    if (dto.tokenUrl !== undefined) definition.tokenUrl = dto.tokenUrl;
    if (dto.revokeUrl !== undefined) definition.revokeUrl = dto.revokeUrl;
    if (dto.scopes !== undefined) definition.scopes = dto.scopes;
    if (dto.pkceEnabled !== undefined) definition.pkceEnabled = dto.pkceEnabled;
    if (dto.enabled !== undefined) definition.enabled = dto.enabled;
    if (dto.sortOrder !== undefined) definition.sortOrder = dto.sortOrder;

    if (dto.clientId && dto.clientId !== '****') {
      definition.clientId = this.cryptoService.encrypt(dto.clientId);
    }
    if (dto.clientSecret && dto.clientSecret !== '****') {
      definition.clientSecret = this.cryptoService.encrypt(dto.clientSecret);
    }
    if (dto.tenantId !== undefined) {
      if (dto.tenantId && dto.tenantId !== '****') {
        definition.tenantId = this.cryptoService.encrypt(dto.tenantId);
      } else if (dto.tenantId === '') {
        definition.tenantId = undefined;
      }
    }

    await definition.save();

    this.logger.log('Connected app definition updated', { appKey: definition.appKey });

    return this.toAdminResponse(definition.toObject());
  }

  async delete(id: string): Promise<{ deletedConnections: number }> {
    const definition = await this.definitionModel.findById(id);
    if (!definition) {
      throw new NotFoundException(ErrorCode.CONNECTED_APP_NOT_FOUND, 'Connected app not found');
    }

    const result = await this.connectionModel.deleteMany({ appKey: definition.appKey });
    await this.definitionModel.deleteOne({ _id: id });

    this.logger.log('Connected app definition deleted', {
      appKey: definition.appKey,
      deletedConnections: result.deletedCount,
    });

    return { deletedConnections: result.deletedCount };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toAdminResponse(d: any, connectedUserCount = 0): ConnectedAppAdminResponse {
    return {
      id: (d._id || d.id).toString(),
      appKey: d.appKey,
      displayName: d.displayName,
      description: d.description,
      iconKey: d.iconKey,
      clientId: '****',
      clientSecret: '****',
      tenantId: d.tenantId ? '****' : undefined,
      authorizationUrl: d.authorizationUrl,
      tokenUrl: d.tokenUrl,
      revokeUrl: d.revokeUrl,
      scopes: d.scopes,
      pkceEnabled: d.pkceEnabled,
      enabled: d.enabled,
      sortOrder: d.sortOrder,
      connectedUserCount,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private getAppKeysFromEnv(): Record<string, string> {
    try {
      const envValue = process.env.COMMON_APP_KEYS;
      if (!envValue) {
        this.logger.debug('COMMON_APP_KEYS not in env, using defaults');
        return DEFAULT_COMMON_APP_KEYS as Record<string, string>;
      }

      const parsed = JSON.parse(envValue);

      // Handle both array format ["github", "google", ...] and object format {"github":"GitHub", ...}
      if (Array.isArray(parsed)) {
        // Array contains lowercase app names, use as both key and display name
        const result: Record<string, string> = {};
        parsed.forEach((appName: string) => {
          const key = appName.toLowerCase();
          result[key] = appName; // Use exactly as provided in env
        });
        this.logger.debug('Loaded COMMON_APP_KEYS from env (array format)', { count: Object.keys(result).length });
        return result;
      }

      this.logger.debug('Loaded COMMON_APP_KEYS from env (object format)', { count: Object.keys(parsed).length });
      return parsed;
    } catch (error) {
      this.logger.error('Failed to parse COMMON_APP_KEYS from env, using defaults', String(error));
      return DEFAULT_COMMON_APP_KEYS as Record<string, string>;
    }
  }

  getPresets() {
    const appKeys = this.getAppKeysFromEnv();
    return Object.entries(appKeys).map(([key, displayName]) => ({
      key,
      displayName,
      appKey: key,
    }));
  }

  async validateAppKey(appKey: string): Promise<{ valid: boolean; exists: boolean; suggestion?: string }> {
    const formatRegex = /^[a-z0-9-]+$/;

    if (!formatRegex.test(appKey)) {
      return {
        valid: false,
        exists: false,
        suggestion: appKey.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      };
    }

    const existing = await this.definitionModel.findOne({ appKey: appKey.toLowerCase() }).lean().exec();

    return {
      valid: true,
      exists: !!existing,
    };
  }

  async suggestAppKey(displayName: string): Promise<string> {
    const slug = collapseRepeatedChar(
      collapseWhitespace(
        displayName
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9-]/g, ''),
        '-',
      ),
      '-',
    );

    let baseKey = slug;
    let counter = 1;

    while (await this.definitionModel.exists({ appKey: baseKey })) {
      baseKey = `${slug}-${counter}`;
      counter++;
    }

    return baseKey;
  }

  async generateCallbackUrl(appKey: string, backendUrl?: string): Promise<string> {
    const apiPrefix = process.env.API_PREFIX || 'api';
    const baseUrl = backendUrl || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${baseUrl}/${apiPrefix}/v1/connected-apps/${appKey}/callback`;
  }
}
