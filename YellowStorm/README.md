# YelloStorm

AI Agent Chat Platform with Real-time Streaming

## Architecture

```
┌──────────────┐      SSE       ┌──────────────┐      gRPC      ┌──────────────┐
│   Browser    │◄──────────────►│   Backend    │◄──────────────►│  AI Service  │
│   React 18   │   HTTP/1.1     │   NestJS 10  │    HTTP/2      │   LiteLLM    │
│   Zustand    │   JSON/Text    │   MongoDB    │    Protobuf    │  Agent Team  │
└──────────────┘                └──────────────┘                └──────────────┘
```

| Metric          | Value             |
| --------------- | ----------------- |
| Component Types | 14                |
| Backend Modules | 18                |
| Streaming FPS   | ~60               |
| Protocol        | Dual (gRPC + SSE) |

## Tech Stack

### Backend

| Technology         | Purpose                     |
| ------------------ | --------------------------- |
| NestJS 10          | Modular Node.js framework   |
| MongoDB/Mongoose 8 | Database                    |
| Passport JWT       | Authentication              |
| gRPC               | AI service communication    |
| SSE                | Real-time browser streaming |
| Azure Blob Storage | Document storage            |
| Socket.io          | Notifications               |

### Frontend

| Technology        | Purpose           |
| ----------------- | ----------------- |
| React 18          | UI framework      |
| Vite 6            | Build tool        |
| Tailwind CSS 4    | Styling           |
| shadcn/ui (Radix) | Component library |
| Zustand           | State management  |
| React Router 6    | Routing           |
| Axios             | HTTP client       |

## Features

- **AI Chat** - Real-time streaming responses with 14 component types
- **Workspaces** - Document management with RAG integration
- **Authentication** - JWT + Microsoft OAuth
- **Usage Tracking** - Plan limits and token counting
- **Notifications** - Real-time SSE notifications
- **Sharing** - Public conversation links
- **Admin** - User management, content moderation

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB 6+
- Azure Storage Account
- SMTP Server
- LiteLLM instance (gRPC)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd YelloStorm

# Install backend dependencies
cd back
npm install
cp .env.example .env
# Configure .env with your settings

# Install frontend dependencies
cd ../front
npm install
```

### Development

```bash
# Terminal 1: Backend
cd back
npm run start:dev

# Terminal 2: Frontend
cd front
npm run dev
```

### Production Build

```bash
# Backend
cd back
npm run build
npm run start:prod

# Frontend
cd front
npm run build
npm run preview
```

## Project Structure

```
YelloStorm/
├── back/                        # NestJS Backend
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/              # Configuration files
│   │   ├── common/              # Shared utilities
│   │   └── modules/             # Feature modules (18)
│   │       ├── auth/
│   │       ├── user/
│   │       ├── conversation/
│   │       ├── workspace/
│   │       ├── models/
│   │       ├── usage/
│   │       ├── notifications/
│   │       ├── authorization/
│   │       ├── analytics/
│   │       ├── health/
│   │       ├── system/
│   │       ├── logger/
│   │       ├── database/
│   │       ├── document/
│   │       ├── email/
│   │       ├── exceptions/
│   │       ├── rate-limiter/
│   │       ├── request-context/
│   │       └── response/
│   └── test/
├── front/                       # React Frontend
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui components
│   │   │   └── ai-elements/     # AI chat components
│   │   ├── modules/             # Feature modules
│   │   │   ├── auth/
│   │   │   ├── conversation/
│   │   │   ├── workspace/
│   │   │   ├── profile/
│   │   │   ├── sidebar/
│   │   │   ├── usage/
│   │   │   └── notifications/
│   │   ├── contexts/
│   │   └── lib/
│   └── public/
└── README.md
```

## Design Philosophy

### Modular Architecture

Each module is self-contained with its own controllers, services, DTOs, and interfaces. Modules export typed functions that other modules can import and use—pass data in the expected format and it works (plug-and-play).

```
Module A                         Module B
┌─────────────┐                 ┌─────────────┐
│ README.md   │  ◄── docs ──►   │ README.md   │
│ index.ts    │  ◄── exports    │ index.ts    │
│ service.ts  │─────────────────│ service.ts  │
│ interfaces/ │  typed contract │ interfaces/ │
└─────────────┘                 └─────────────┘
```

### Frontend Component Strategy

We use **shadcn/ui** instead of building custom components:

| Approach          | Trade-off                                                 |
| ----------------- | --------------------------------------------------------- |
| Custom components | Weeks debugging edge cases, accessibility, browser quirks |
| shadcn/ui         | Battle-tested, community-supported, WCAG compliant        |

**Result:** 80% of development time on business logic, not component bugs.

## Configuration

### Backend Environment Variables

| Variable                          | Required | Description                                                                               |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`                        | Yes      | Environment (development/production)                                                      |
| `PORT`                            | Yes      | Server port (default: 3000)                                                               |
| `MONGODB_URI`                     | Yes      | MongoDB connection string                                                                 |
| `JWT_SECRET`                      | Yes      | JWT signing secret (min 32 chars)                                                         |
| `FRONTEND_URL`                    | Yes      | URL to Frontend                                                                           |
| `BACKEND_URL`                     | Yes      | Backend URL without trailing slash default: `http:localhost:3000`                         |
| `CORS_ORIGIN`                     | Yes      | Allowed origins (comma-separated)                                                         |
| `MEMORY_LIMIT_MB`                 | Yes      | Memory limit in megabytes (minimum 64) default `512`                                      |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes      | Azure storage connection string                                                           |
| `AZURE_STORAGE_CONTAINER_NAME`    | Yes      | Storage container name                                                                    |
| `AZURE_STORAGE_ACCOUNT_NAME`      | Yes      | Azure storage account name                                                                |
| `MONGODB_URI`                     | Yes      | MongoDB connection string                                                                 |
| `CONVERSATION_GRPC_URL`           | Yes      | gRPC server (default: `localhost:50051`)                                                  |
| `SMTP_HOST`                       | Yes      | SMTP server hostname                                                                      |
| `SMTP_PORT`                       | Yes      | SMTP server port (1-65535)                                                                |
| `SMTP_SECURE`                     | Yes      | Use TLS/SSL (true for port 465)                                                           |
| `SMTP_USER`                       | Yes      | SMTP authentication username                                                              |
| `SMTP_PASSWORD`                   | Yes      | SMTP authentication password                                                              |
| `EMAIL_FROM_NAME`                 | Yes      | Sender display name default `YelloStorm`                                                  |
| `EMAIL_FROM_ADDRESS`              | Yes      | Sender email address `noreply@yellostorm.com`                                             |
| `INDEXING_API_URL`                | Yes      | 3rd party indexing API URL `http://localhost:4000`                                        |
| `INDEXING_API_KEY`                | YES      | API key for webhook authentication `''`                                                   |
| `INDEXING_API_USERNAME`           | Yes      | API username default: `azer`                                                              |
| `INDEXING_API_PASSWORD`           | Yes      | API Password `azer`                                                                       |
| `API_ADK_URL`                     | Yes      | ADK API URL                                                                               |
| `EMAIL_PROVIDER`                  | Yes      | Email provider: `smtp` or `outlook` `smtp` Check Email module readme for more information |

### Frontend Environment Variables

| Variable       | Description                                             |
| -------------- | ------------------------------------------------------- |
| `VITE_API_URL` | Backend API URL (default: http://localhost:3000/api/v1) |

## Module Documentation

Each backend module includes comprehensive documentation:

| Module        | Description          | Documentation                                      |
| ------------- | -------------------- | -------------------------------------------------- |
| Auth          | JWT, OAuth, Sessions | [README](back/src/modules/auth/README.md)          |
| User          | Profiles, Consents   | [README](back/src/modules/user/README.md)          |
| Conversation  | Chat, Streaming      | [README](back/src/modules/conversation/README.md)  |
| Workspace     | Documents, Settings  | [README](back/src/modules/workspace/README.md)     |
| Models        | LLM Management       | [README](back/src/modules/models/README.md)        |
| Usage         | Plans, Quotas        | [README](back/src/modules/usage/README.md)         |
| Authorization | RBAC, Permissions    | [README](back/src/modules/authorization/README.md) |
| Notifications | Real-time SSE        | [README](back/src/modules/notifications/README.md) |
| Exceptions    | Error Handling       | [README](back/src/modules/exceptions/README.md)    |

## API Documentation

Swagger UI available at `/api/docs` in development mode.

### Response Format

```typescript
// Success
{ success: true, data: T, timestamp: string }

// Error
{ success: false, error: { code, message, statusCode, requestId } }
```

### Error Code Ranges

| Range     | Domain            |
| --------- | ----------------- |
| 1000-1099 | General           |
| 1100-1199 | Authentication    |
| 1200-1299 | User              |
| 1300-1399 | Agent             |
| 1400-1499 | Conversation      |
| 1500-1599 | External Services |
| 1600-1699 | System            |
| 1700-1799 | Usage/Plans       |
| 1800-1899 | Notifications     |
| 1900-1999 | Workspaces        |

## Streaming Architecture

### Why Dual Protocol?

| Segment           | Protocol | Reason                                            |
| ----------------- | -------- | ------------------------------------------------- |
| Backend ↔ AI      | gRPC     | Type safety, no split chunks, HTTP/2 multiplexing |
| Backend → Browser | SSE      | Native browser support, auto-reconnect            |

### gRPC (Backend ↔ AI Service)

- Protocol Buffers for type-safe messaging
- HTTP/2 multiplexed streams
- 14 component types (text, code, reasoning, plan, etc.)
- Guaranteed message delivery (no split chunks)

We migrated from SSE to gRPC for server-to-server communication due to:

- Frequent disconnects under load
- Chunks split mid-JSON causing parse errors
- Manual `BEGIN_MSG`/`END_MSG` delimiters needed
- No built-in backpressure or flow control

### SSE (Backend → Browser)

- Native browser EventSource API
- 15s heartbeat keep-alive
- 60fps throttled delivery
- Auto-reconnection

## Commands

### Backend

```bash
npm run start:dev      # Development server
npm run build          # Production build
npm run start:prod     # Run production
npm run test           # Unit tests
npm run test:e2e       # E2E tests
npm run lint           # ESLint
npm run format         # Prettier
```

### Frontend

```bash
npm run dev            # Vite dev server
npm run build          # Production build
npm run preview        # Preview build
```

## Versioning

YelloStorm uses [Conventional Commits](https://www.conventionalcommits.org/) with automated version bumping via `commit-and-tag-version`.

> For the full development pipeline, branching strategy, and commit conventions, see [CONTRIBUTING.md](./CONTRIBUTING.md).

### Version Tags

| Package  | Tag Format | Example        |
| -------- | ---------- | -------------- |
| Backend  | `back-v*`  | `back-v1.0.0`  |
| Frontend | `front-v*` | `front-v1.0.0` |

### Release Commands

Run from either `back/` or `front/` directory:

```bash
npm run release          # Auto-determine bump from commits
npm run release:patch    # Force patch (0.0.1 → 0.0.2)
npm run release:minor    # Force minor (0.0.1 → 0.1.0)
npm run release:major    # Force major (0.0.1 → 1.0.0)
npm run release:first    # Initialize first release
npm run release:exp      # Experimental pre-release (0.1.0 → 0.1.1-exp.0)
```

After releasing, push with tags:

```bash
git push --follow-tags
```

## License

MIT
