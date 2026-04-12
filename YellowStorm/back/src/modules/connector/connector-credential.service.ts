import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { BadRequestException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import {
  CreateConnectorCredentialDto,
  UpdateConnectorCredentialDto,
} from './dto';
import {
  ConnectorCredential,
  ConnectorCredentialDocument,
} from './schemas/connector-credential.schema';
import { IConnectorCredentialResponse } from './interfaces/connector.interface';

@Injectable()
export class ConnectorCredentialService {
  constructor(
    @InjectModel(ConnectorCredential.name)
    private readonly credentialModel: Model<ConnectorCredentialDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorCredentialService.name);
  }

  async create(userId: string, dto: CreateConnectorCredentialDto): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialModel.create({
      connectorId: new Types.ObjectId(dto.connectorId),
      displayName: dto.displayName,
      authPayload: dto.authPayload,
      status: 'active',
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      lastValidatedAt: new Date(),
      userId: new Types.ObjectId(userId),
    });

    return this.toResponse(credential);
  }

  async findAllForUser(
    userId: string,
    options?: { connectorId?: string; status?: string },
  ): Promise<IConnectorCredentialResponse[]> {
    const filter: FilterQuery<ConnectorCredentialDocument> = {
      userId: new Types.ObjectId(userId),
    };
    if (options?.connectorId) {
      filter.connectorId = new Types.ObjectId(options.connectorId);
    }
    if (options?.status) {
      filter.status = options.status;
    }

    const credentials = await this.credentialModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return credentials.map((c) => this.toResponse(c));
  }

  async findById(id: string, userId: string): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialModel
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }
    return this.toResponse(credential);
  }

  async findByIdRaw(id: string, userId: string): Promise<ConnectorCredentialDocument | null> {
    const cred = await this.credentialModel
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .exec();
    if (cred) return cred;
    return this.credentialModel.findById(id).exec();
  }

  async findActiveByConnectorId(connectorId: string): Promise<ConnectorCredentialDocument | null> {
    return this.credentialModel
      .findOne({
        connectorId: new Types.ObjectId(connectorId),
        status: 'active',
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(id: string, userId: string, dto: UpdateConnectorCredentialDto): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialModel
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .exec();
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }

    const updateData: Record<string, unknown> = {};
    if (dto.displayName !== undefined) updateData.displayName = dto.displayName;
    if (dto.authPayload !== undefined) updateData.authPayload = dto.authPayload;
    if (dto.expiresAt !== undefined) updateData.expiresAt = new Date(dto.expiresAt);

    const updated = await this.credentialModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string, userId: string): Promise<void> {
    const credential = await this.credentialModel
      .findOneAndDelete({ _id: id, userId: new Types.ObjectId(userId) })
      .exec();
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }
  }

  async validateCredential(id: string, userId: string): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialModel
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .exec();
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }

    const now = new Date();
    const isExpired = credential.expiresAt && credential.expiresAt < now;

    const updateData: Record<string, unknown> = {
      lastValidatedAt: now,
      status: isExpired ? 'expired' : 'active',
    };

    const updated = await this.credentialModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .lean()
      .exec();

    return this.toResponse(updated);
  }

  toResponse(doc: any): IConnectorCredentialResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      connectorId: doc.connectorId?.toString() ?? '',
      displayName: doc.displayName,
      status: doc.status,
      lastValidatedAt: doc.lastValidatedAt,
      expiresAt: doc.expiresAt,
      userId: doc.userId?.toString() ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
