import { Inject, Injectable } from '@nestjs/common';
import {
  USER_APP_CONNECTION_STORE,
  type UserAppConnectionStore,
} from '../persistence/connected-app.store';
import { ConnectionStatus } from '../connected-app.types';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { LoggerService } from '@modules/logger';
import {
  ConnectedAppWithStatus,
  UserConnectionResponse,
} from '../interfaces/connected-app.interface';

@Injectable()
export class ConnectedAppUserService {
  constructor(
    @Inject(USER_APP_CONNECTION_STORE)
    private readonly connectionStore: UserAppConnectionStore,
    private readonly definitionService: ConnectedAppDefinitionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppUserService.name);
  }

  async getAvailableApps(userId: string): Promise<ConnectedAppWithStatus[]> {
    const [apps, connections] = await Promise.all([
      this.definitionService.findAllEnabled(),
      this.connectionStore.listActiveByUser(userId),
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
              iconKey: app.iconKey ?? undefined,
              status: connection.status,
              scopes: connection.scopes,
              providerEmail: connection.providerEmail ?? undefined,
              connectedAt: connection.createdAt,
            }
          : undefined,
      };
    });
  }

  async getUserConnections(userId: string): Promise<UserConnectionResponse[]> {
    const connections = await this.connectionStore.listActiveByUser(userId);

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
        iconKey: app.iconKey ?? undefined,
        status: c.status,
        scopes: c.scopes,
        providerEmail: c.providerEmail ?? undefined,
        connectedAt: c.createdAt,
      });
    }
    return results;
  }
}
