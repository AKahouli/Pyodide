import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger';
import { NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import {
  CreateConnectorCredentialDto,
  UpdateConnectorCredentialDto,
} from './dto';
import {
  type ConnectorCredentialRow,  
} from './persistence/connector.store';
import { IConnectorCredentialResponse } from './interfaces/connector.interface';
import { PgConnectorCredentialStore } from './persistence/pg-connector.store';

@Injectable()
export class ConnectorCredentialService {
  constructor(
    private readonly credentialStore: PgConnectorCredentialStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorCredentialService.name);
  }

  async create(userId: string, dto: CreateConnectorCredentialDto): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialStore.insert({
      connectorId: dto.connectorId,
      displayName: dto.displayName,
      authPayload: dto.authPayload,
      status: 'active',
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      userId,
    });

    return this.toResponse(credential);
  }

  async findAllForUser(
    userId: string,
    options?: { connectorId?: string; status?: string },
  ): Promise<IConnectorCredentialResponse[]> {
    const credentials = await this.credentialStore.list({
      userId,
      connectorId: options?.connectorId,
      status: options?.status,
    });

    return credentials.map((c) => this.toResponse(c));
  }

  async findById(id: string, userId: string): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialStore.findByIdAndUser(id, userId);
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }
    return this.toResponse(credential);
  }

  async findByIdRaw(id: string, userId: string): Promise<ConnectorCredentialRow | null> {
    return this.credentialStore.findByIdAndUser(id, userId);
  }

  async findActiveByConnectorId(connectorId: string, userId: string): Promise<ConnectorCredentialRow | null> {
    return this.credentialStore.findActiveFor(connectorId, userId);
  }

  async update(id: string, userId: string, dto: UpdateConnectorCredentialDto): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialStore.findByIdAndUser(id, userId);
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }

    const updated = await this.credentialStore.update(id, {
      ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
      ...(dto.authPayload !== undefined ? { authPayload: dto.authPayload } : {}),
      ...(dto.expiresAt !== undefined ? { expiresAt: new Date(dto.expiresAt) } : {}),
    });
    if (!updated) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string, userId: string): Promise<void> {
    const credential = await this.credentialStore.deleteByIdAndUser(id, userId);
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }
  }

  async validateCredential(id: string, userId: string): Promise<IConnectorCredentialResponse> {
    const credential = await this.credentialStore.findByIdAndUser(id, userId);
    if (!credential) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND);
    }

    const now = new Date();
    const isExpired = credential.expiresAt && credential.expiresAt < now;

    const updated = await this.credentialStore.update(id, {
      lastValidatedAt: now,
      status: isExpired ? 'expired' : 'active',
    });

    return this.toResponse(updated!);
  }

  toResponse(doc: ConnectorCredentialRow): IConnectorCredentialResponse {
    return {
      id: doc.id,
      connectorId: doc.connectorId,
      displayName: doc.displayName,
      status: doc.status,
      lastValidatedAt: doc.lastValidatedAt,
      expiresAt: doc.expiresAt,
      userId: doc.userId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
