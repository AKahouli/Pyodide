import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserAppConnection,
  UserAppConnectionDocument,
  ConnectionStatus,
} from '../schemas/user-app-connection.schema';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { LoggerService } from '@modules/logger';
import {
  ConnectedAppWithStatus,
  UserConnectionResponse,
} from '../interfaces/connected-app.interface';

@Injectable()
export class ConnectedAppUserService {
  constructor(
    @InjectModel(UserAppConnection.name)
    private readonly connectionModel: Model<UserAppConnectionDocument>,
    private readonly definitionService: ConnectedAppDefinitionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppUserService.name);
  }

  async getAvailableApps(userId: string): Promise<ConnectedAppWithStatus[]> {
    const [apps, connections] = await Promise.all([
      this.definitionService.findAllEnabled(),
      this.connectionModel
        .find({ userId: new Types.ObjectId(userId), status: ConnectionStatus.ACTIVE })
        .lean()
        .exec(),
    ]);

    const connectionMap = new Map(connections.map((c) => [c.appKey, c]));

    return apps.map((app) => {
      const connection = connectionMap.get(app.appKey);
      return {
        ...app,
        connected: !!connection,
        connection: connection
          ? {
              appKey: connection.appKey,
              displayName: app.displayName,
              iconKey: app.iconKey,
              status: connection.status,
              scopes: connection.scopes,
              providerEmail: connection.providerEmail,
              connectedAt: connection.createdAt,
            }
          : undefined,
      };
    });
  }

  async getUserConnections(userId: string): Promise<UserConnectionResponse[]> {
    const connections = await this.connectionModel
      .find({ userId: new Types.ObjectId(userId), status: ConnectionStatus.ACTIVE })
      .lean()
      .exec();

    if (connections.length === 0) return [];

    const apps = await this.definitionService.findAllEnabled();
    const appMap = new Map(apps.map((a) => [a.appKey, a]));

    const results: UserConnectionResponse[] = [];
    for (const c of connections) {
      const app = appMap.get(c.appKey);
      if (!app) continue;
      results.push({
        appKey: c.appKey,
        displayName: app.displayName,
        iconKey: app.iconKey,
        status: c.status,
        scopes: c.scopes,
        providerEmail: c.providerEmail,
        connectedAt: c.createdAt,
      });
    }
    return results;
  }
}
