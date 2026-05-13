# Request Context Module

Provides request-scoped context with request ID and correlation ID for distributed tracing.

## Features

- **Request ID Generation** - Automatic UUID generation for each request
- **Correlation ID Propagation** - Pass correlation IDs across service boundaries
- **AsyncLocalStorage** - Thread-safe context propagation
- **Response Headers** - Automatic `X-Request-ID` and `X-Correlation-ID` headers

## Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Request-ID` | In/Out | Unique request identifier |
| `X-Correlation-ID` | In/Out | Correlation ID for distributed tracing |
| `request-id` | In | Alternative request ID header |
| `correlation-id` | In | Alternative correlation ID header |
| `x-amzn-trace-id` | In | AWS trace ID support |

## Usage

### Access Request Context in Services

```typescript
import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@modules/request-context';

@Injectable()
export class MyService {
  constructor(private readonly requestContext: RequestContextService) {}

  doSomething() {
    const requestId = this.requestContext.getRequestId();
    const correlationId = this.requestContext.getCorrelationId();
    const elapsedTime = this.requestContext.getElapsedTime();

    console.log(`Request ${requestId} - ${elapsedTime}ms elapsed`);
  }
}
```

### Access in Controller

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';

@Controller()
export class MyController {
  @Get()
  handle(@Req() req: Request) {
    const { requestId, correlationId, startTime } = req.context;
    return { requestId };
  }
}
```

### Set User ID After Authentication

```typescript
import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@modules/request-context';

@Injectable()
export class AuthService {
  constructor(private readonly requestContext: RequestContextService) {}

  async validateToken(token: string) {
    const user = await this.verifyToken(token);
    this.requestContext.setUserId(user.id);
    return user;
  }
}
```

## Distributed Tracing

When calling other services, forward the request ID and correlation ID:

```typescript
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RequestContextService } from '@modules/request-context';

@Injectable()
export class ExternalService {
  constructor(
    private readonly httpService: HttpService,
    private readonly requestContext: RequestContextService,
  ) {}

  async callExternalAPI() {
    const headers = {
      'X-Request-ID': this.requestContext.getRequestId(),
      'X-Correlation-ID': this.requestContext.getCorrelationId(),
    };

    return this.httpService.get('https://api.example.com', { headers });
  }
}
```

## Integration with Logger

The request ID is automatically available in the logger context for log correlation.
