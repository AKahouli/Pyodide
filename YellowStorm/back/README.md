# YelloStorm Backend

A modular, well-documented NestJS backend for the YelloStorm AI Agent Chat application. Built with a **documentation-first** approach and **highly modular architecture**, enabling teams to understand, maintain, and extend the codebase with confidence.

## Table of Contents

- [Philosophy](#philosophy)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Module System](#module-system)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Testing](#testing)

---

## Philosophy

### Documentation-First

Every module in this codebase includes comprehensive documentation. This isn't an afterthought—it's a core principle:

```
src/modules/
├── auth/README.md           # Authentication & JWT
├── authorization/README.md  # RBAC & permissions
├── conversation/README.md   # AI chat & streaming
├── user/README.md           # User management
├── workspace/README.md      # Document workspaces
├── models/README.md         # AI model management
├── system/README.md         # Maintenance mode
├── usage/README.md          # Plans & usage tracking
├── notifications/README.md  # Real-time notifications
├── health/README.md         # Health checks
├── logger/README.md         # Structured logging
├── database/README.md       # MongoDB connection
├── document/README.md       # Azure Blob storage
├── email/README.md          # SMTP email
├── exceptions/README.md     # Error handling
├── rate-limiter/README.md   # Request throttling
├── request-context/README.md # Request-scoped context
├── response/README.md       # Response formatting
└── analytics/README.md      # Usage analytics
```

Each README provides:

- **Architecture diagrams** showing data flow
- **API endpoint documentation** with request/response examples
- **Code examples** for common use cases
- **Configuration reference** for environment variables
- **Error handling** patterns and error codes

### Modular Architecture

The backend follows NestJS's modular design philosophy, taken to its logical conclusion:

- **Self-contained modules**: Each module owns its controllers, services, schemas, DTOs, and interfaces
- **Clear boundaries**: Modules communicate through well-defined service interfaces
- **Independent documentation**: Each module can be understood in isolation
- **Pluggable design**: Modules can be added, removed, or replaced with minimal impact

---

## Tech Stack

### Core Framework

| Technology     | Version | Purpose                   |
| -------------- | ------- | ------------------------- |
| **NestJS**     | 10.x    | Modular Node.js framework |
| **TypeScript** | 5.x     | Type-safe development     |
| **Node.js**    | 20+     | Runtime environment       |

### Data & Storage

| Technology             | Purpose                             |
| ---------------------- | ----------------------------------- |
| **MongoDB**            | Primary database (via Mongoose 8.x) |
| **Azure Blob Storage** | Document and file storage           |

### Authentication & Security

| Technology      | Purpose                       |
| --------------- | ----------------------------- |
| **Passport.js** | Authentication middleware     |
| **JWT**         | Access & refresh tokens       |
| **bcrypt**      | Password hashing (12 rounds)  |
| **Helmet**      | Security headers              |
| **CORS**        | Cross-origin resource sharing |

### Communication

| Technology     | Purpose                       |
| -------------- | ----------------------------- |
| **gRPC**       | AI service communication      |
| **SSE**        | Real-time streaming responses |
| **Socket.io**  | Real-time notifications       |
| **Nodemailer** | Email delivery                |
| **Axios**      | HTTP client                   |

### Development & Quality

| Technology          | Purpose                  |
| ------------------- | ------------------------ |
| **Swagger/OpenAPI** | API documentation        |
| **Jest**            | Testing framework        |
| **ESLint**          | Code linting             |
| **Prettier**        | Code formatting          |
| **Joi**             | Configuration validation |
| **class-validator** | DTO validation           |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            YELLOSTORM BACKEND                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                          INCOMING REQUESTS                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         GLOBAL MIDDLEWARE                                │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │    │
│  │  │  Helmet  │ │   CORS   │ │ Compress │ │  Cookie  │ │  Logger  │      │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                          GLOBAL GUARDS                                   │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │ MaintenanceGuard│  │  JwtAuthGuard   │  │  RateLimiter    │         │    │
│  │  │ (503 if maint.) │  │ (@Public bypass)│  │ (throttling)    │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         FEATURE MODULES                                  │    │
│  │                                                                          │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │    Auth     │  │    User     │  │Conversation │  │  Workspace  │    │    │
│  │  │  - Login    │  │  - Profile  │  │  - Chat     │  │  - Docs     │    │    │
│  │  │  - Register │  │  - Consents │  │  - Stream   │  │  - Upload   │    │    │
│  │  │  - OAuth    │  │  - Admin    │  │  - Branch   │  │  - Settings │    │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │    │
│  │                                                                          │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │   Models    │  │    Usage    │  │Authorization│  │   System    │    │    │
│  │  │  - Sync     │  │  - Plans    │  │  - RBAC     │  │ - Maintain  │    │    │
│  │  │  - LiteLLM  │  │  - Limits   │  │  - Roles    │  │ - Settings  │    │    │
│  │  │  - Default  │  │  - Track    │  │  - Audit    │  │             │    │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │    │
│  │                                                                          │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │    │
│  │  │Notifications│  │  Analytics  │  │   Health    │                      │    │
│  │  │  - SSE      │  │  - Events   │  │  - Probes   │                      │    │
│  │  │  - Realtime │  │  - Metrics  │  │  - Status   │                      │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         GLOBAL MODULES                                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │    │
│  │  │  Logger  │ │ Database │ │ Document │ │  Email   │ │ Response │      │    │
│  │  │ (Winston)│ │(MongoDB) │ │ (Azure)  │ │ (SMTP)   │ │(Standard)│      │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                                 │    │
│  │  │Exception │ │  Rate    │ │ Request  │                                 │    │
│  │  │ Handler  │ │ Limiter  │ │ Context  │                                 │    │
│  │  └──────────┘ └──────────┘ └──────────┘                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       EXTERNAL SERVICES                                  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │    │
│  │  │ MongoDB  │ │  Azure   │ │ LiteLLM  │ │Microsoft │                   │    │
│  │  │ Atlas    │ │  Blob    │ │  (gRPC)  │ │  OAuth   │                   │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Module System

### Global Modules

Always available throughout the application without explicit imports:

| Module                   | Purpose                         | Documentation                                   |
| ------------------------ | ------------------------------- | ----------------------------------------------- |
| **LoggerModule**         | Structured logging with context | [README](src/modules/logger/README.md)          |
| **DatabaseModule**       | MongoDB connection management   | [README](src/modules/database/README.md)        |
| **DocumentModule**       | Azure Blob Storage integration  | [README](src/modules/document/README.md)        |
| **EmailModule**          | SMTP email with templates       | [README](src/modules/email/README.md)           |
| **ResponseModule**       | Standardized API responses      | [README](src/modules/response/README.md)        |
| **ExceptionsModule**     | Global error handling           | [README](src/modules/exceptions/README.md)      |
| **RateLimiterModule**    | Request throttling              | [README](src/modules/rate-limiter/README.md)    |
| **RequestContextModule** | Request-scoped context          | [README](src/modules/request-context/README.md) |

### Feature Modules

Business logic organized by domain:

| Module                  | Purpose                             | Documentation                                 |
| ----------------------- | ----------------------------------- | --------------------------------------------- |
| **AuthModule**          | JWT authentication, OAuth, sessions | [README](src/modules/auth/README.md)          |
| **UserModule**          | User accounts, profiles, consents   | [README](src/modules/user/README.md)          |
| **AuthorizationModule** | RBAC, roles, permissions, audit     | [README](src/modules/authorization/README.md) |
| **ConversationModule**  | AI chat, streaming, branches, groups| [README](src/modules/conversation/README.md)  |
| **WorkspaceModule**     | Document workspaces, uploads        | [README](src/modules/workspace/README.md)     |
| **ModelsModule**        | AI model sync with LiteLLM          | [README](src/modules/models/README.md)        |
| **UsageModule**         | Plans, quotas, usage tracking       | [README](src/modules/usage/README.md)         |
| **NotificationsModule** | Real-time SSE notifications         | [README](src/modules/notifications/README.md) |
| **SystemModule**        | Maintenance mode control            | [README](src/modules/system/README.md)        |
| **AnalyticsModule**     | Usage analytics and metrics         | [README](src/modules/analytics/README.md)     |
| **HealthModule**        | Health checks and probes            | [README](src/modules/health/README.md)        |

### Module Anatomy

Each module follows a consistent structure:

```
module-name/
├── README.md                    # Comprehensive documentation
├── index.ts                     # Public exports
├── module-name.module.ts        # NestJS module definition
├── module-name.controller.ts    # HTTP endpoints
├── module-name.service.ts       # Business logic
├── schemas/                     # MongoDB schemas
│   └── entity.schema.ts
├── interfaces/                  # TypeScript interfaces
│   └── entity.interface.ts
├── dto/                         # Validation DTOs
│   ├── create-entity.dto.ts
│   └── update-entity.dto.ts
├── guards/                      # Route guards (if needed)
├── decorators/                  # Custom decorators (if needed)
└── exceptions/                  # Module-specific exceptions (if needed)
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB 6+
- Azure Storage Account (for documents)
- SMTP Server (for emails)
- LiteLLM instance (for AI models)

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Configure environment variables
# Edit .env with your settings
```

### Running

```bash
# Development (with hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

---

## Project Structure

```
back/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── app.module.ts           # Root module
│   ├── config/                 # Configuration files
│   │   ├── config.schema.ts    # Joi validation schema
│   │   ├── app.config.ts       # General app config
│   │   ├── jwt.config.ts       # JWT settings
│   │   ├── auth.config.ts      # Auth settings
│   │   └── ...                 # Other configs
│   ├── modules/                # Feature modules (see above)
│   └── common/                 # Shared utilities
│       ├── decorators/         # Shared decorators
│       ├── dto/                # Shared DTOs
│       └── interceptors/       # Shared interceptors
├── test/                       # E2E tests
├── package.json
├── tsconfig.json
└── README.md                   # This file
```

---

## Configuration

### Environment Variables

All configuration is validated at startup using Joi schemas. See `src/config/config.schema.ts` for the complete schema.

#### Required Variables

| Variable     | Required         | Description                                                       | Default                                         |
| ------------ | ---------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `JWT_SECRET` | Yes (production) | JWT signing secret. Must be at least 32 characters in production. | `dev-only-insecure-secret-change-in-production` |

#### Application Core

| Variable          | Required | Description                                                    | Default                 |
| ----------------- | -------- | -------------------------------------------------------------- | ----------------------- |
| `APP_NAME`        | Yes      | Application display name                                       | `YelloStorm`            |
| `NODE_ENV`        | Yes      | Environment mode: `development`, `production`, or `test`       | `development`           |
| `BACKEND_URL`     | Yes      | Backend URL without trailing slash                             | `http:localhost:3000`   |
| `PORT`            | Yes      | Server port number                                             | `3000`                  |
| `API_PREFIX`      | No       | API route prefix                                               | `api`                   |
| `FRONTEND_URL`    | Yes      | Frontend application URL                                       | `http://localhost:5173` |
| `CORS_ORIGIN`     | Yes      | CORS origin domain for allowed requests                        | `http://localhost:5173` |
| `LOG_LEVEL`       | No       | Logging verbosity: `error`, `warn`, `info`, `debug`, `verbose` | `info`                  |
| `MEMORY_LIMIT_MB` | Yes      | Memory limit in megabytes (minimum 64)                         | `512`                   |

#### Rate Limiting

| Variable         | Required | Description                          | Default |
| ---------------- | -------- | ------------------------------------ | ------- |
| `THROTTLE_TTL`   | No       | Throttle time window in seconds      | `60`    |
| `THROTTLE_LIMIT` | No       | Maximum requests per throttle window | `100`   |

#### MongoDB Database

| Variable                           | Required | Description                                   | Default                                |
| ---------------------------------- | -------- | --------------------------------------------- | -------------------------------------- |
| `MONGODB_URI`                      | Yes      | MongoDB connection string                     | `mongodb://localhost:27017/yellostorm` |
| `MONGODB_MAX_POOL_SIZE`            | No       | Maximum connection pool size (1-100)          | `10`                                   |
| `MONGODB_MIN_POOL_SIZE`            | No       | Minimum connection pool size (0-50)           | `2`                                    |
| `MONGODB_SERVER_SELECTION_TIMEOUT` | No       | Server selection timeout in ms (min 1000)     | `5000`                                 |
| `MONGODB_SOCKET_TIMEOUT`           | No       | Socket timeout in ms (min 1000)               | `45000`                                |
| `MONGODB_CONNECT_TIMEOUT`          | No       | Connection timeout in ms (min 1000)           | `10000`                                |
| `MONGODB_RETRY_WRITES`             | No       | Enable write retries                          | `true`                                 |
| `MONGODB_RETRY_READS`              | No       | Enable read retries                           | `true`                                 |
| `MONGODB_MAX_IDLE_TIME`            | No       | Max idle time before closing connection in ms | `60000`                                |
| `MONGODB_HEARTBEAT_FREQUENCY`      | No       | Connection heartbeat interval in ms (min 500) | `10000`                                |
| `MONGODB_RECONNECT_ENABLED`        | No       | Enable auto-reconnection                      | `true`                                 |
| `MONGODB_RECONNECT_INITIAL_DELAY`  | No       | Initial reconnect delay in ms (min 100)       | `1000`                                 |
| `MONGODB_RECONNECT_MAX_DELAY`      | No       | Maximum reconnect delay in ms (min 1000)      | `30000`                                |
| `MONGODB_RECONNECT_MAX_ATTEMPTS`   | No       | Max reconnect attempts (0 = infinite)         | `0`                                    |
| `MONGODB_RECONNECT_MULTIPLIER`     | No       | Exponential backoff multiplier (1-10)         | `2`                                    |

#### Azure Blob Storage

| Variable                             | Required | Description                               | Default               |
| ------------------------------------ | -------- | ----------------------------------------- | --------------------- |
| `AZURE_STORAGE_CONNECTION_STRING`    | Yes      | Azure storage connection string           | `''` (empty)          |
| `AZURE_STORAGE_CONTAINER_NAME`       | Yes      | Storage container name                    | `documents`           |
| `AZURE_STORAGE_ACCOUNT_NAME`         | Yes      | Azure storage account name                | `''` (empty)          |
| `STORAGE_MAX_FILE_SIZE_MB`           | No       | Maximum file size for upload (1-500 MB)   | `50`                  |
| `STORAGE_MAX_FILES_PER_UPLOAD`       | No       | Maximum files per upload request (1-50)   | `10`                  |
| `SEMANTIC_DATASET_STORAGE_PREFIX`    | No       | Ceph/S3 folder for prepared semantic datasets | `semantic-model/datasets` |
| `SEMANTIC_DATASET_MAX_SIZE_MB`       | No       | Maximum prepared Parquet upload size      | `200`                 |
| `STORAGE_SAS_EXPIRY_MINUTES`         | No       | SAS URL expiry duration (1-10080 min)     | `60`                  |
| `STORAGE_ALLOWED_MIME_TYPES`         | No       | Allowed file MIME types (comma-separated) | `application/pdf,...` |
| `STORAGE_HEALTH_CHECK_ENABLED`       | No       | Enable storage health checks              | `true`                |
| `STORAGE_HEALTH_CHECK_INTERVAL_MS`   | No       | Health check interval (10000-3600000 ms)  | `60000`               |
| `STORAGE_RECONNECT_ENABLED`          | No       | Enable auto-reconnection                  | `true`                |
| `STORAGE_RECONNECT_INITIAL_DELAY_MS` | No       | Initial reconnect delay in ms (min 100)   | `1000`                |
| `STORAGE_RECONNECT_MAX_DELAY_MS`     | No       | Maximum reconnect delay in ms (min 1000)  | `30000`               |
| `STORAGE_RECONNECT_MAX_ATTEMPTS`     | No       | Max reconnect attempts (0 = unlimited)    | `0`                   |
| `STORAGE_RECONNECT_MULTIPLIER`       | No       | Exponential backoff multiplier (1-10)     | `2`                   |

#### Workspace Configuration

| Variable                               | Required | Description                                    | Default               |
| -------------------------------------- | -------- | ---------------------------------------------- | --------------------- |
| `WORKSPACE_MAX_FILE_SIZE_MB`           | No       | Maximum file size for workspace uploads        | `500`                 |
| `WORKSPACE_MAX_FILES_PER_BULK_UPLOAD`  | No       | Maximum files per bulk upload                  | `50`                  |
| `WORKSPACE_SMALL_FILE_THRESHOLD_MB`    | No       | Threshold for small file handling              | `10`                  |
| `WORKSPACE_UPLOAD_SESSION_TTL_MINUTES` | No       | Upload session time-to-live                    | `60`                  |
| `WORKSPACE_SAS_URL_EXPIRY_MINUTES`     | No       | SAS URL expiry for workspace                   | `60`                  |
| `WORKSPACE_ALLOWED_MIME_TYPES`         | No       | Allowed workspace file types (comma-separated) | `application/pdf,...` |

#### JWT Authentication

| Variable             | Required | Description                   | Default          |
| -------------------- | -------- | ----------------------------- | ---------------- |
| `JWT_ISSUER`         | No       | JWT issuer claim              | `yellostorm`     |
| `JWT_AUDIENCE`       | No       | JWT audience claim            | `yellostorm-api` |

#### Authentication Settings

| Variable                               | Required | Description                                        | Default         |
| -------------------------------------- | -------- | -------------------------------------------------- | --------------- |
| `AUTH_BCRYPT_ROUNDS`                   | No       | Bcrypt hashing rounds (10-14)                      | `12`            |
| `AUTH_EMAIL_VERIFICATION_EXPIRY_HOURS` | No       | Email verification token expiry (1-168 hours)      | `24`            |
| `AUTH_MAX_SESSIONS_PER_USER`           | No       | Maximum concurrent sessions per user (1-50)        | `10`            |
| `AUTH_REFRESH_TOKEN_COOKIE_NAME`       | No       | Refresh token cookie name                          | `refresh_token` |
| `AUTH_COOKIE_SAME_SITE`                | No       | Cookie SameSite attribute: `strict`, `lax`, `none` | `strict`        |

#### Microsoft OAuth (Optional)

| Variable                  | Required | Description                   | Default                                             |
| ------------------------- | -------- | ----------------------------- | --------------------------------------------------- |
| `MICROSOFT_CLIENT_ID`     | No       | Microsoft OAuth client ID     | `''` (empty)                                        |
| `MICROSOFT_CLIENT_SECRET` | No       | Microsoft OAuth client secret | `''` (empty)                                        |
| `MICROSOFT_TENANT_ID`     | No       | Microsoft tenant ID           | `common`                                            |
| `MICROSOFT_REDIRECT_URI`  | No       | OAuth redirect callback URL   | `http://localhost:3000/api/auth/microsoft/callback` |

#### Email (SMTP)

| Variable                           | Required | Description                              | Default                  |
| ---------------------------------- | -------- | ---------------------------------------- | ------------------------ |
| `EMAIL_PROVIDER`                   | Yes      | Email provider: `smtp` or `outlook`      | `smtp`                   |
| `SMTP_HOST`                        | Yes      | SMTP server hostname                     | `''` (empty)             |
| `SMTP_PORT`                        | Yes      | SMTP server port (1-65535)               | `587`                    |
| `SMTP_SECURE`                      | Yes      | Use TLS/SSL (true for port 465)          | `false`                  |
| `SMTP_USER`                        | Yes      | SMTP authentication username             | `''` (empty)             |
| `SMTP_PASSWORD`                    | Yes      | SMTP authentication password             | `''` (empty)             |
| `EMAIL_FROM_NAME`                  | Yes      | Sender display name                      | `YelloStorm`             |
| `EMAIL_FROM_ADDRESS`               | Yes      | Sender email address                     | `noreply@yellostorm.com` |
| `EMAIL_POOL_ENABLED`               | No       | Enable connection pooling                | `true`                   |
| `EMAIL_POOL_MAX_CONNECTIONS`       | No       | Maximum pool connections (1-50)          | `5`                      |
| `EMAIL_POOL_MAX_MESSAGES`          | No       | Maximum messages per connection (1-1000) | `100`                    |
| `EMAIL_RETRY_ENABLED`              | No       | Enable send retry logic                  | `true`                   |
| `EMAIL_RETRY_MAX_ATTEMPTS`         | No       | Maximum retry attempts (1-10)            | `3`                      |
| `EMAIL_RETRY_INITIAL_DELAY`        | No       | Initial retry delay in ms (min 100)      | `1000`                   |
| `EMAIL_RETRY_MAX_DELAY`            | No       | Maximum retry delay in ms (min 1000)     | `10000`                  |
| `EMAIL_RETRY_MULTIPLIER`           | No       | Exponential backoff multiplier (1-5)     | `2`                      |
| `EMAIL_CONNECTION_TIMEOUT`         | No       | Connection timeout in ms (min 1000)      | `10000`                  |
| `EMAIL_SOCKET_TIMEOUT`             | No       | Socket timeout in ms (min 1000)          | `30000`                  |
| `EMAIL_RATE_LIMIT_PER_SECOND`      | No       | Rate limit per second                    | `10`                     |
| `EMAIL_RATE_LIMIT_PER_MINUTE`      | No       | Rate limit per minute                    | `100`                    |
| `EMAIL_HEALTH_CHECK_ENABLED`       | No       | Enable health checks                     | `true`                   |
| `EMAIL_HEALTH_CHECK_INTERVAL_MS`   | No       | Health check interval (10000-3600000 ms) | `60000`                  |
| `EMAIL_RECONNECT_ENABLED`          | No       | Enable auto-reconnection                 | `true`                   |
| `EMAIL_RECONNECT_INITIAL_DELAY_MS` | No       | Initial reconnect delay in ms (min 100)  | `1000`                   |
| `EMAIL_RECONNECT_MAX_DELAY_MS`     | No       | Maximum reconnect delay in ms (min 1000) | `30000`                  |
| `EMAIL_RECONNECT_MAX_ATTEMPTS`     | No       | Max reconnect attempts (0 = unlimited)   | `0`                      |
| `EMAIL_RECONNECT_MULTIPLIER`       | No       | Exponential backoff multiplier (1-10)    | `2`                      |

#### Health Monitoring

| Variable                        | Required | Description                                | Default |
| ------------------------------- | -------- | ------------------------------------------ | ------- |
| `HEALTH_HISTORY_ENABLED`        | No       | Enable health history tracking             | `true`  |
| `HEALTH_CHECK_INTERVAL_SECONDS` | No       | Health check interval (10-3600 seconds)    | `30`    |
| `HEALTH_RETENTION_HOURS`        | No       | Health data retention period (1-168 hours) | `24`    |

#### Conversation/gRPC

| Variable                                      | Required | Description                                    | Default           |
| --------------------------------------------- | -------- | ---------------------------------------------- | ----------------- |
| `CONVERSATION_GRPC_URL`                       | Yes      | gRPC server address                            | `localhost:50051` |
| `CONVERSATION_GRPC_TIMEOUT_MS`                | No       | gRPC call timeout (5000-300000 ms)             | `120000`          |
| `CONVERSATION_MAX_CONCURRENT_STREAMS`         | No       | Maximum concurrent gRPC streams (1-20)         | `5`               |
| `CONVERSATION_SSE_HEARTBEAT_MS`               | No       | Server-Sent Events heartbeat (5000-60000 ms)   | `15000`           |
| `CONVERSATION_MAX_SSE_CONNECTIONS`            | No       | Maximum concurrent SSE connections (1-20)      | `5`               |
| `CONVERSATION_MAX_MESSAGE_LENGTH`             | No       | Maximum message character length (1000-100000) | `50000`           |
| `CONVERSATION_MAX_FILES_PER_MESSAGE`          | No       | Maximum files per message (1-20)               | `5`               |
| `CONVERSATION_SHARE_EXPIRY_DAYS`              | No       | Conversation share link expiry (1-365 days)    | `30`              |
| `CONVERSATION_SYSTEM_WORKSPACE_STORAGE_BYTES` | No       | System workspace storage quota (min 1048576)   | `52428800`        |

#### LiteLLM Integration

| Variable                             | Required | Description                              | Default      |
| ------------------------------------ | -------- | ---------------------------------------- | ------------ |
| `LITELLM_API_URL`                    | Yes      | LiteLLM API endpoint URL                 | `''` (empty) |
| `LITELLM_API_KEY`                    | Yes      | LiteLLM API key                          | `''` (empty) |
| `LITELLM_TIMEOUT_MS`                 | No       | LiteLLM request timeout (1000-60000 ms)  | `10000`      |
| `LITELLM_HEALTH_CHECK_ENABLED`       | No       | Enable health checks                     | `true`       |
| `LITELLM_HEALTH_CHECK_INTERVAL_MS`   | No       | Health check interval (10000-3600000 ms) | `60000`      |
| `LITELLM_RECONNECT_ENABLED`          | No       | Enable auto-reconnection                 | `true`       |
| `LITELLM_RECONNECT_INITIAL_DELAY_MS` | No       | Initial reconnect delay in ms (min 100)  | `1000`       |
| `LITELLM_RECONNECT_MAX_DELAY_MS`     | No       | Maximum reconnect delay in ms (min 1000) | `30000`      |
| `LITELLM_RECONNECT_MAX_ATTEMPTS`     | No       | Max reconnect attempts (0 = unlimited)   | `0`          |
| `LITELLM_RECONNECT_MULTIPLIER`       | No       | Exponential backoff multiplier (1-10)    | `2`          |

#### Logging Persistence

| Variable                        | Required | Description                                          | Default                     |
| ------------------------------- | -------- | ---------------------------------------------------- | --------------------------- |
| `LOGGING_MONGODB_URI`           | No       | Separate MongoDB URI for logs                        | Falls back to `MONGODB_URI` |
| `LOGGING_BUFFER_SIZE`           | No       | Log buffer size before flush (10-10000)              | `100`                       |
| `LOGGING_FLUSH_INTERVAL_MS`     | No       | Log flush interval (1000-60000 ms)                   | `60000`                     |
| `LOGGING_TTL_DAYS`              | No       | Log retention duration (1-365 days)                  | `30`                        |
| `LOGGING_PERSISTENCE_ENABLED`   | No       | Enable database persistence                          | `true`                      |
| `LOGGING_DEFAULT_SAVE`          | No       | Save logs to DB by default                           | `true`                      |
| `LOGGING_DEFAULT_DISPLAY`       | No       | Display logs to console by default                   | `true`                      |
| `LOGGING_MAX_POOL_SIZE`         | No       | Connection pool size for logging (1-10)              | `3`                         |
| `LOGGING_DISPLAY_ONLY_CONTEXTS` | No       | Contexts to only display, not save (comma-separated) | (internal defaults)         |

#### Notifications

| Variable                                | Required | Description                            | Default |
| --------------------------------------- | -------- | -------------------------------------- | ------- |
| `NOTIFICATION_TTL_DAYS`                 | No       | Notification retention period in days  | `30`    |
| `NOTIFICATION_MAX_CONNECTIONS_PER_USER` | No       | Maximum WebSocket connections per user | `5`     |
| `NOTIFICATION_HEARTBEAT_INTERVAL_MS`    | No       | WebSocket heartbeat interval in ms     | `15000` |
| `NOTIFICATION_MAX_PAYLOAD_SIZE_BYTES`   | No       | Maximum notification payload size      | `10240` |

#### Indexing Service

| Variable                    | Required                         | Description                        | Default                                                    |
| --------------------------- | -------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `INDEXING_API_URL`          | Yes                              | 3rd party indexing API URL         | `http://localhost:4000`                                    |
| `INDEXING_API_KEY`          | Yes                              | API key for webhook authentication | `''`                                                       |
| `INDEXING_API_USERNAME`     | Yes                              | API username                       | azer                                                       |
| `INDEXING_API_PASSWORD`     | Yes                              | API Password                       | azer                                                       |
| `INDEXING_API_URL`          | Yes                              | API metachatbot url                | https://frfrwalabaidevmetachatbotapi0001.azurewebsites.net |
| `API_ADK_URL` │ Yes         | ADK API URL │ ''                 |
| `INDEXING_BATCH_SIZE` │ No  | Documents per batch │ 10         |
| `INDEXING_INTERVAL_MS` │ No | Processing interval (30s) │ 3000 |
| `INDEXING_TIMEOUT_MS` │ No  | Indexing timeout (1h) │ 3600000  |
| `INDEXING_ENABLED` │ No     | Enable/disable indexing │ Yes    |

### Path Aliases

```typescript
// tsconfig.json paths
"@/*"        → "src/*"
"@modules/*" → "src/modules/*"
"@common/*"  → "src/common/*"
"@config/*"  → "src/config/*"
```

---

## API Documentation

### Swagger UI

Available at `/api/docs` when running in development mode.

### Response Format

All API responses follow a consistent structure:

```typescript
// Success
{
  "success": true,
  "data": T,
  "timestamp": "2024-01-16T10:00:00Z"
}

// Error
{
  "success": false,
  "error": {
    "code": "ERR_1200",
    "message": "User not found",
    "statusCode": 404,
    "requestId": "req-123"
  }
}
```

### Error Codes

Organized by module range:

| Range     | Module            |
| --------- | ----------------- |
| 1000-1099 | General errors    |
| 1100-1199 | Authentication    |
| 1200-1299 | User              |
| 1300-1399 | Agent             |
| 1400-1499 | Conversation      |
| 1500-1599 | External services |
| 1600-1699 | System            |
| 1700-1799 | Usage/Plans       |
| 1800-1899 | Notifications     |
| 1900-1999 | Workspaces        |

See [ExceptionsModule README](src/modules/exceptions/README.md) for complete error code reference.

---

## Development

### Commands

```bash
# Start development server
npm run start:dev

# Lint code
npm run lint

# Format code
npm run format

# Build for production
npm run build
```

### Code Style

- **ESLint** enforces code quality rules
- **Prettier** handles formatting
- Run `npm run lint` before committing

### Adding a New Module

1. Create module directory: `src/modules/my-module/`
2. Create module structure (see Module Anatomy above)
3. Write comprehensive README.md
4. Register in `app.module.ts`
5. Export from `index.ts`

### Guards and Decorators

```typescript
// All routes require JWT by default
// Use @Public() to make a route public
@Public()
@Get('status')
getStatus() { ... }

// Use @SkipMaintenance() to bypass maintenance mode
@SkipMaintenance()
@Get('health')
healthCheck() { ... }

// Use @RateLimitSkip() to bypass rate limiting
@RateLimitSkip()
@Get('webhook')
handleWebhook() { ... }

// Use @RequirePermissions() for RBAC
@RequirePermissions(Permissions.USERS_READ)
@Get('admin/users')
listUsers() { ... }
```

---

## Testing

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

### Test Structure

```
src/
├── modules/
│   └── user/
│       ├── user.service.ts
│       └── user.service.spec.ts  # Unit tests alongside source
test/
├── app.e2e-spec.ts               # E2E tests
└── jest-e2e.json                 # E2E Jest config
```

---

## Contributing

### Documentation Requirements

When adding or modifying a module:

1. **Update the module's README.md** with any API changes
2. **Include architecture diagrams** for complex flows
3. **Document all error codes** the module can throw
4. **Provide code examples** for common use cases

### Commit Guidelines

- Keep commits focused and atomic
- Reference module documentation in PR descriptions
- Update relevant READMEs in the same PR as code changes

---

## License

MIT
