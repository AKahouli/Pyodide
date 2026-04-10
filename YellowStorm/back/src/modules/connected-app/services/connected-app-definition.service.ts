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
import { CreateConnectedAppDefinitionDto } from '../dto/create-connected-app-definition.dto';
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
}
