# Exceptions Module

A production-grade, global exception handling module for structured error responses.

## Features

- **Global Exception Filter** - Catches ALL errors automatically
- **Structured Responses** - Consistent JSON format for frontend consumption
- **Error Codes** - Typed codes for frontend error handling
- **User-Friendly Messages** - Production-safe messages, detailed in development
- **Request Tracking** - UUID for each error for debugging
- **Validation Support** - Field-level error details for forms
- **Automatic Logging** - 5xx logged as error, 4xx as warn

## Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERR_1200",
    "message": "User not found.",
    "statusCode": 404,
    "timestamp": "2024-01-14T12:00:00.000Z",
    "path": "/api/v1/users/123",
    "method": "GET",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "details": []
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| **General (1000-1099)** ||
| ERR_1000 | Internal server error |
| ERR_1001 | Validation error |
| ERR_1002 | Not found |
| ERR_1003 | Unauthorized |
| ERR_1004 | Forbidden |
| ERR_1005 | Conflict |
| ERR_1006 | Bad request |
| ERR_1007 | Too many requests |
| ERR_1008 | Service unavailable |
| **Auth (1100-1199)** ||
| ERR_1100 | Invalid credentials |
| ERR_1101 | Token expired |
| ERR_1102 | Token invalid |
| ERR_1103 | Session expired |
| ERR_1104 | Email not verified |
| ERR_1105 | Profile incomplete |
| ERR_1106 | Session not found |
| ERR_1107 | Refresh token invalid |
| ERR_1108 | Refresh token expired |
| ERR_1109 | Microsoft auth failed |
| ERR_1110 | Account suspended |
| ERR_1111 | Invalid credentials |
| ERR_1112 | Invalid token |
| ERR_1113 | Session revoked |
| ERR_1114 | Verification token expired |
| ERR_1115 | Email already verified |
| ERR_1116 | Password reset token invalid or already used |
| ERR_1117 | Password reset token expired |
| ERR_1120 | Auth token missing (SSE) |
| **User (1200-1299)** ||
| ERR_1200 | User not found |
| ERR_1201 | User already exists |
| ERR_1202 | User inactive |
| **Agent (1300-1399)** ||
| ERR_1300 | Agent not found |
| ERR_1301 | Agent unavailable |
| ERR_1302 | Agent limit reached |
| **Chat (1400-1499)** ||
| ERR_1400 | Chat not found |
| ERR_1401 | Message too long |
| ERR_1402 | Chat rate limited |
| **External (1500-1599)** ||
| ERR_1500 | External service error |
| ERR_1501 | AI service error |
| ERR_1502 | AI service timeout |

## Usage

### Throwing Exceptions

```typescript
import {
  NotFoundException,
  ValidationException,
  UnauthorizedException,
  ErrorCode
} from '@modules/exceptions';

// Simple not found
throw new NotFoundException(ErrorCode.USER_NOT_FOUND);

// With custom message
throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User with ID 123 not found');

// Validation errors with field details
throw new ValidationException([
  { field: 'email', message: 'Invalid email format' },
  { field: 'password', message: 'Password must be at least 8 characters' }
]);

// Unauthorized with specific code
throw new UnauthorizedException(ErrorCode.AUTH_TOKEN_EXPIRED);
```

### Available Exception Classes

```typescript
import {
  BadRequestException,
  ValidationException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  TooManyRequestsException,
  InternalServerException,
  ServiceUnavailableException,
} from '@modules/exceptions';
```

### Custom Exception

```typescript
import { AppException, ErrorCode } from '@modules/exceptions';
import { HttpStatus } from '@nestjs/common';

throw new AppException({
  code: ErrorCode.AGENT_UNAVAILABLE,
  message: 'Agent is currently processing another request',
  statusCode: HttpStatus.SERVICE_UNAVAILABLE,
  details: [{ field: 'agentId', message: 'Agent busy', value: 'agent-123' }],
});
```

## Adding New Error Codes

1. Add the code to `constants/error-codes.ts`:

```typescript
export enum ErrorCode {
  // ... existing codes

  // My new feature errors (1600-1699)
  MY_FEATURE_ERROR = 'ERR_1600',
}

export const ErrorMessages: Record<ErrorCode, string> = {
  // ... existing messages

  [ErrorCode.MY_FEATURE_ERROR]: 'My feature encountered an error.',
};
```

2. Use it in your service:

```typescript
throw new BadRequestException(ErrorCode.MY_FEATURE_ERROR);
```

## Request ID Tracking

The filter checks for existing request IDs in headers:
- `request-id`
- `x-request-id`

If not present, generates a UUID. Use this ID to trace errors in logs.
