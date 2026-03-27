# Database Module

Global MongoDB database module using Mongoose ODM with production-grade configuration and resilient connection handling.

## Features

- **Non-blocking Startup**: Application starts even if MongoDB is unavailable
- **Exponential Backoff Reconnection**: Automatic retry with configurable backoff strategy
- **Connection Pooling**: Configurable min/max pool sizes for optimal resource usage
- **Graceful Shutdown**: Proper connection cleanup on application termination
- **Event Logging**: Comprehensive connection event logging
- **Health Monitoring**: Connection state checking for health endpoints
- **Jitter**: Random jitter on reconnection delays to prevent thundering herd
- **Production Optimizations**: Auto-indexing disabled in production

## Connection Behavior

### Startup
1. Application attempts to connect to MongoDB at startup
2. If connection fails, the app **continues to run** (does not crash)
3. Reconnection attempts begin with exponential backoff
4. Health checks report database as `down` until connected

### Reconnection Strategy
- **Initial delay**: 1 second (configurable)
- **Multiplier**: 2x (configurable)
- **Max delay**: 30 seconds (configurable)
- **Max attempts**: Unlimited by default (configurable)
- **Jitter**: ±10% random variation to prevent thundering herd

Example backoff sequence: 1s → 2s → 4s → 8s → 16s → 30s → 30s → ...

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017/yellostorm` | MongoDB connection string |
| `MONGODB_MAX_POOL_SIZE` | `10` | Maximum connections in pool |
| `MONGODB_MIN_POOL_SIZE` | `2` | Minimum connections in pool |
| `MONGODB_SERVER_SELECTION_TIMEOUT` | `5000` | Server selection timeout (ms) |
| `MONGODB_SOCKET_TIMEOUT` | `45000` | Socket timeout (ms) |
| `MONGODB_CONNECT_TIMEOUT` | `10000` | Initial connection timeout (ms) |
| `MONGODB_RETRY_WRITES` | `true` | Enable automatic write retries |
| `MONGODB_RETRY_READS` | `true` | Enable automatic read retries |
| `MONGODB_MAX_IDLE_TIME` | `60000` | Max idle time for connections (ms) |
| `MONGODB_HEARTBEAT_FREQUENCY` | `10000` | Server monitoring frequency (ms) |

### Reconnection Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_RECONNECT_ENABLED` | `true` | Enable automatic reconnection |
| `MONGODB_RECONNECT_INITIAL_DELAY` | `1000` | Initial retry delay (ms) |
| `MONGODB_RECONNECT_MAX_DELAY` | `30000` | Maximum retry delay (ms) |
| `MONGODB_RECONNECT_MAX_ATTEMPTS` | `0` | Max attempts (0 = unlimited) |
| `MONGODB_RECONNECT_MULTIPLIER` | `2` | Backoff multiplier |

## Usage

### Basic Schema Definition

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  name: string;
}

export type UserDocument = User & Document;
export const UserSchema = SchemaFactory.createForClass(User);
```

### Registering Schemas in Feature Modules

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
    ]),
  ],
})
export class UsersModule {}
```

### Using in Services

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async create(data: Partial<User>): Promise<UserDocument> {
    const user = new this.userModel(data);
    return user.save();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }
}
```

### Checking Connection Status

```typescript
import { Injectable } from '@nestjs/common';
import { DatabaseConnectionService } from '@modules/database';

@Injectable()
export class SomeService {
  constructor(private readonly dbConnection: DatabaseConnectionService) {}

  checkDb(): boolean {
    return this.dbConnection.isConnected();
  }

  getDbInfo() {
    return this.dbConnection.getConnectionInfo();
    // Returns: { state, host, port, name, reconnectAttempts, isReconnecting }
  }
}
```

### Handling Database Unavailability

When database is unavailable, operations will throw errors. Handle them gracefully:

```typescript
import { Injectable } from '@nestjs/common';
import { DatabaseConnectionService } from '@modules/database';
import { ServiceUnavailableException } from '../exceptions';

@Injectable()
export class SomeService {
  constructor(private readonly dbConnection: DatabaseConnectionService) {}

  async someOperation() {
    if (!this.dbConnection.isConnected()) {
      throw new ServiceUnavailableException('Database is currently unavailable');
    }
    // Proceed with database operation
  }
}
```

## Health Checks

The module integrates with the Health module:

- **`/health`**: Shows database status in checks
- **`/health/ready`**: Returns `not_ready` if database is down (Kubernetes readiness)
- **`/health/live`**: Always returns `ok` (Kubernetes liveness)

This ensures:
- Kubernetes won't kill the pod when DB is down (liveness passes)
- Kubernetes won't route traffic when DB is down (readiness fails)
- Pod can auto-recover when DB comes back online

## Events Logged

| Event | Level | Description |
|-------|-------|-------------|
| Connection attempt | INFO | Each connection/reconnection attempt |
| Connected | INFO | Connection established |
| Disconnected | WARN | Connection lost |
| Reconnected | INFO | Connection re-established |
| Error | ERROR | Connection error |
| Close | INFO | Connection closed |
| Reconnect scheduled | INFO | Next retry scheduled with delay |
| Max attempts reached | ERROR | Giving up reconnection |

## Production Considerations

### Connection Pool Sizing

- **General rule**: `maxPoolSize` = expected concurrent operations
- **CPU-bound apps**: 5-10 connections
- **I/O-bound apps**: 20-50 connections
- Monitor and adjust based on actual usage

### Security Best Practices

1. **Use authentication**: Always include credentials in connection string
2. **Enable TLS/SSL**: Use `tls=true` in connection options
3. **IP Whitelisting**: Restrict database access to known IPs
4. **Least Privilege**: Use database users with minimal required permissions
5. **Secrets Management**: Store credentials in environment variables or secret managers

### Connection String Examples

Local development:
```
MONGODB_URI=mongodb://localhost:27017/yellostorm
```

With authentication:
```
MONGODB_URI=mongodb://user:password@localhost:27017/yellostorm?authSource=admin
```

MongoDB Atlas:
```
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/yellostorm?retryWrites=true&w=majority
```

Replica set:
```
MONGODB_URI=mongodb://host1:27017,host2:27017,host3:27017/yellostorm?replicaSet=rs0
```
