import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { LoggerService } from '../logger';

@Injectable()
export class DatabaseConnectionService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DatabaseConnectionService.name);
  }

  isConnected(): boolean {
    return this.connection?.readyState === ConnectionStates.connected;
  }

  getConnection(): Connection {
    return this.connection;
  }

  getConnectionState(): string {
    if (!this.connection) return 'not_initialized';

    const states: Record<ConnectionStates, string> = {
      [ConnectionStates.disconnected]: 'disconnected',
      [ConnectionStates.connected]: 'connected',
      [ConnectionStates.connecting]: 'connecting',
      [ConnectionStates.disconnecting]: 'disconnecting',
      [ConnectionStates.uninitialized]: 'uninitialized',
    };

    return states[this.connection.readyState] || 'unknown';
  }

  getConnectionInfo(): {
    state: string;
    host: string | undefined;
    port: number | undefined;
    name: string | undefined;
    reconnectAttempts: number;
    isReconnecting: boolean;
  } {
    return {
      state: this.getConnectionState(),
      host: this.connection?.host,
      port: this.connection?.port,
      name: this.connection?.name,
      reconnectAttempts: 0, // MongooseModule handles reconnection internally
      isReconnecting: this.connection?.readyState === 2, // 2 = connecting
    };
  }
}
