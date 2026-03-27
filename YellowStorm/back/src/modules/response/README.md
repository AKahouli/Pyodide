# Response Module

Global response interceptor that wraps all successful responses in a consistent format.

## Response Format

All successful API responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2024-01-14T12:00:00.000Z",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "path": "/api/v1/users",
    "duration": 45
  }
}
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Always `true` for successful responses |
| `data` | `T` | The actual response data |
| `meta.timestamp` | `string` | ISO 8601 timestamp |
| `meta.requestId` | `string` | Request ID for tracing |
| `meta.path` | `string` | Request path |
| `meta.duration` | `number` | Response time in milliseconds |

## Error Responses

Error responses are handled by the Exceptions module and follow a different format:

```json
{
  "success": false,
  "error": {
    "code": "ERR_1002",
    "message": "Resource not found",
    "statusCode": 404,
    ...
  }
}
```

## Pagination

For paginated responses, use the `PaginatedApiResponse` interface:

```typescript
import { PaginatedApiResponse } from '@modules/response';

interface UserListResponse extends PaginatedApiResponse<User> {}
```

Response format:

```json
{
  "success": true,
  "data": [...],
  "meta": { ... },
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

## Skipping Response Transformation

For endpoints that should return raw data (e.g., file downloads), use:

```typescript
import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_INTERCEPTOR = 'skipResponseInterceptor';
export const RawResponse = () => SetMetadata(SKIP_RESPONSE_INTERCEPTOR, true);
```

## Usage with Types

Define response types for better type safety:

```typescript
import { ApiResponse } from '@modules/response';

interface User {
  id: string;
  email: string;
}

// Controller returns User, but client receives ApiResponse<User>
@Get(':id')
async getUser(@Param('id') id: string): Promise<User> {
  return this.usersService.findOne(id);
}
```
