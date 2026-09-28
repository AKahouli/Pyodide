import { Injectable } from '@nestjs/common';
import {  
  type ConnectedAppDefinitionRow,    
} from '../persistence/connected-app.store';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateConnectedAppDefinitionDto, DEFAULT_COMMON_APP_KEYS } from '../dto/create-connected-app-definition.dto';
import { UpdateConnectedAppDefinitionDto } from '../dto/update-connected-app-definition.dto';
import {
  ConnectedAppAdminResponse,
  ConnectedAppPublicResponse,
  DecryptedAppConfig,
} from '../interfaces/connected-app.interface';
import { PgUserAppConnectionStore } from '../persistence/pg-connected-app.store';
import { PgConnectedAppDefinitionStore } from '../persistence/pg-connected-app.store';

@Injectable()
export class ConnectedAppDefinitionService {
  constructor(
    private readonly definitionStore: PgConnectedAppDefinitionStore,
    private readonly connectionStore: PgUserAppConnectionStore,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppDefinitionService.name);
  }

  async findAllEnabled(): Promise<ConnectedAppPublicResponse[]> {
    const definitions = await this.definitionStore.findAllEnabled();

    return definitions.map((d) => ({
      appKey: d.appKey,
      displayName: d.displayName,
      description: d.description ?? undefined,
      iconKey: d.iconKey ?? undefined,
      scopes: d.scopes,
      sortOrder: d.sortOrder,
    }));
  }

  async findAll(): Promise<ConnectedAppAdminResponse[]> {
    const definitions = await this.definitionStore.findAll();

    return Promise.all(
      definitions.map(async (d) => {
        const connectedUserCount = await this.connectionStore.countByAppKey(d.appKey);
        return this.toAdminResponse(d, connectedUserCount);
      }),
    );
  }

  async findByKey(appKey: string): Promise<DecryptedAppConfig> {
    const definition = await this.definitionStore.findByKey(appKey);

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
      description: definition.description ?? undefined,
      clientId: this.cryptoService.decrypt(definition.clientId),
      clientSecret: this.cryptoService.decrypt(definition.clientSecret),
      tenantId: definition.tenantId ? this.cryptoService.decrypt(definition.tenantId) : undefined,
      authorizationUrl: definition.authorizationUrl,
      tokenUrl: definition.tokenUrl,
      revokeUrl: definition.revokeUrl ?? undefined,
      scopes: definition.scopes,
      pkceEnabled: definition.pkceEnabled,
      enabled: definition.enabled,
    };
  }

  async findById(id: string): Promise<ConnectedAppAdminResponse> {
    const definition = await this.definitionStore.findById(id);
    if (!definition) {
      throw new NotFoundException(ErrorCode.CONNECTED_APP_NOT_FOUND, 'Connected app not found');
    }
    const connectedUserCount = await this.connectionStore.countByAppKey(definition.appKey);
    return this.toAdminResponse(definition, connectedUserCount);
  }

  async create(dto: CreateConnectedAppDefinitionDto): Promise<ConnectedAppAdminResponse> {
    const existing = await this.definitionStore.findByKey(dto.appKey);
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONNECTED_APP_ALREADY_EXISTS,
        `Connected app '${dto.appKey}' already exists`,
      );
    }

    const definition = await this.definitionStore.insert({
      appKey: dto.appKey.toLowerCase(),
      displayName: dto.displayName,
      description: dto.description ?? null,
      iconKey: dto.iconKey ?? null,
      authorizationUrl: dto.authorizationUrl,
      tokenUrl: dto.tokenUrl,
      revokeUrl: dto.revokeUrl ?? null,
      clientId: this.cryptoService.encrypt(dto.clientId),
      clientSecret: this.cryptoService.encrypt(dto.clientSecret),
      tenantId: dto.tenantId ? this.cryptoService.encrypt(dto.tenantId) : null,
      scopes: dto.scopes,
      pkceEnabled: dto.pkceEnabled ?? true,
      enabled: dto.enabled ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });

    this.logger.log('Connected app definition created', { appKey: definition.appKey });

    return this.toAdminResponse(definition);
  }

  async update(
    id: string,
    dto: UpdateConnectedAppDefinitionDto,
  ): Promise<ConnectedAppAdminResponse> {
    const definition = await this.definitionStore.findById(id);
    if (!definition) {
      throw new NotFoundException(ErrorCode.CONNECTED_APP_NOT_FOUND, 'Connected app not found');
    }

    if (dto.appKey && dto.appKey.toLowerCase() !== definition.appKey) {
      const existing = await this.definitionStore.findByKey(dto.appKey);
      if (existing) {
        throw new ConflictException(
          ErrorCode.CONNECTED_APP_ALREADY_EXISTS,
          `Connected app '${dto.appKey}' already exists`,
        );
      }
      definition.appKey = dto.appKey.toLowerCase();
    }

    // '****' keeps the stored ciphertext (echoed back by the admin UI);
    // '' clears tenantId (Mongo $unset parity).
    const patch: Partial<ConnectedAppDefinitionRow> = {
      ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.iconKey !== undefined ? { iconKey: dto.iconKey } : {}),
      ...(dto.authorizationUrl !== undefined ? { authorizationUrl: dto.authorizationUrl } : {}),
      ...(dto.tokenUrl !== undefined ? { tokenUrl: dto.tokenUrl } : {}),
      ...(dto.revokeUrl !== undefined ? { revokeUrl: dto.revokeUrl } : {}),
      ...(dto.scopes !== undefined ? { scopes: dto.scopes } : {}),
      ...(dto.pkceEnabled !== undefined ? { pkceEnabled: dto.pkceEnabled } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.appKey ? { appKey: dto.appKey.toLowerCase() } : {}),
      ...(dto.clientId && dto.clientId !== '****' ? { clientId: this.cryptoService.encrypt(dto.clientId) } : {}),
      ...(dto.clientSecret && dto.clientSecret !== '****' ? { clientSecret: this.cryptoService.encrypt(dto.clientSecret) } : {}),
    };
    if (dto.tenantId !== undefined && dto.tenantId !== '****') {
      patch.tenantId = dto.tenantId ? this.cryptoService.encrypt(dto.tenantId) : null;
    }

    const updated = await this.definitionStore.update(id, patch);

    this.logger.log('Connected app definition updated', { appKey: updated?.appKey });

    return this.toAdminResponse(updated!);
  }

  async delete(id: string): Promise<{ deletedConnections: number }> {
    const result = await this.definitionStore.deleteWithConnections(id);
    if (!result) {
      throw new NotFoundException(ErrorCode.CONNECTED_APP_NOT_FOUND, 'Connected app not found');
    }

    this.logger.log('Connected app definition deleted', {
      appKey: result.appKey,
      deletedConnections: result.deletedConnections,
    });

    return { deletedConnections: result.deletedConnections };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toAdminResponse(d: ConnectedAppDefinitionRow, connectedUserCount = 0): ConnectedAppAdminResponse {
    return {
      id: d.id,
      appKey: d.appKey,
      displayName: d.displayName,
      description: d.description ?? undefined,
      iconKey: d.iconKey ?? undefined,
      clientId: '****',
      clientSecret: '****',
      tenantId: d.tenantId ? '****' : undefined,
      authorizationUrl: d.authorizationUrl,
      tokenUrl: d.tokenUrl,
      revokeUrl: d.revokeUrl ?? undefined,
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

    return {
      valid: true,
      exists: await this.definitionStore.existsByKey(appKey.toLowerCase()),
    };
  }

  async suggestAppKey(displayName: string): Promise<string> {
    const slug = displayName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-{2,}/g, '-');

    let baseKey = slug;
    let counter = 1;

    while (await this.definitionStore.existsByKey(baseKey)) {
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
