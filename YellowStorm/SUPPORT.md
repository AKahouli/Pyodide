# Error Codes Reference

All error codes used across the YellowStorm application.

Source: `back/src/modules/exceptions/constants/error-codes.ts`

---

## General Errors (1000-1099)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1000` | INTERNAL_ERROR | An unexpected error occurred. Please try again later. |
| `ERR_1001` | VALIDATION_ERROR | The provided data is invalid. |
| `ERR_1002` | NOT_FOUND | The requested resource was not found. |
| `ERR_1003` | UNAUTHORIZED | Authentication is required to access this resource. |
| `ERR_1004` | FORBIDDEN | You do not have permission to access this resource. |
| `ERR_1005` | CONFLICT | The request conflicts with the current state. |
| `ERR_1006` | BAD_REQUEST | The request could not be understood. |
| `ERR_1007` | TOO_MANY_REQUESTS | Too many requests. Please slow down. |
| `ERR_1008` | SERVICE_UNAVAILABLE | The service is temporarily unavailable. |

## Authentication Errors (1100-1199)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1100` | AUTH_INVALID_CREDENTIALS | Invalid email or password. |
| `ERR_1101` | AUTH_TOKEN_EXPIRED | Your session has expired. Please sign in again. |
| `ERR_1102` | AUTH_TOKEN_INVALID | Invalid authentication token. |
| `ERR_1103` | AUTH_SESSION_EXPIRED | Your session has expired. |
| `ERR_1104` | AUTH_EMAIL_NOT_VERIFIED | Please verify your email address. |
| `ERR_1105` | AUTH_PROFILE_INCOMPLETE | Please complete your profile. |
| `ERR_1106` | AUTH_SESSION_NOT_FOUND | Session not found. |
| `ERR_1107` | AUTH_REFRESH_TOKEN_INVALID | Invalid refresh token. |
| `ERR_1108` | AUTH_REFRESH_TOKEN_EXPIRED | Refresh token has expired. |
| `ERR_1109` | AUTH_MICROSOFT_AUTH_FAILED | Microsoft authentication failed. |
| `ERR_1110` | AUTH_ACCOUNT_SUSPENDED | Your account has been suspended. |
| `ERR_1111` | INVALID_CREDENTIALS | Invalid email or password. |
| `ERR_1112` | INVALID_TOKEN | Invalid token. |
| `ERR_1113` | AUTH_SESSION_REVOKED | Your session has been revoked. Please sign in again. |
| `ERR_1114` | VERIFICATION_TOKEN_EXPIRED | Verification token has expired. |
| `ERR_1115` | EMAIL_ALREADY_VERIFIED | Email is already verified. |
| `ERR_1116` | AUTH_RESET_TOKEN_INVALID | The password reset link is invalid or has already been used. |
| `ERR_1117` | AUTH_RESET_TOKEN_EXPIRED | The password reset link has expired. Please request a new one. |
| `ERR_1120` | AUTH_TOKEN_MISSING | Authentication token is required. |

## User Errors (1200-1299)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1200` | USER_NOT_FOUND | User not found. |
| `ERR_1201` | USER_ALREADY_EXISTS | A user with this email already exists. |
| `ERR_1202` | USER_INACTIVE | This account has been deactivated. |

## Agent Errors (1300-1399)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1300` | AGENT_NOT_FOUND | Agent not found. |
| `ERR_1301` | AGENT_UNAVAILABLE | This agent is currently unavailable. |
| `ERR_1302` | AGENT_LIMIT_REACHED | Agent usage limit reached. |

## Chat Errors (1400-1499)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1400` | CHAT_NOT_FOUND | Chat conversation not found. |
| `ERR_1401` | CHAT_MESSAGE_TOO_LONG | Message exceeds maximum length. |
| `ERR_1402` | CHAT_RATE_LIMITED | Message rate limit exceeded. Please wait. |
| `ERR_1403` | CHAT_FORBIDDEN | You do not have access to this conversation. |
| `ERR_1405` | CHAT_STREAM_LIMIT | Maximum concurrent streams reached. |
| `ERR_1406` | CHAT_STREAM_FAILED | AI stream failed unexpectedly. |
| `ERR_1407` | CHAT_STREAM_TIMEOUT | AI stream timed out. |
| `ERR_1408` | CHAT_MESSAGE_NOT_FOUND | Message not found. |
| `ERR_1409` | CHAT_ALREADY_STREAMING | This conversation is already streaming. |
| `ERR_1410` | CHAT_FILE_UPLOAD_LIMIT | Maximum files per message exceeded. |
| `ERR_1411` | CHAT_SHARE_NOT_FOUND | Shared conversation not found. |
| `ERR_1412` | CHAT_SHARE_EXPIRED | Shared conversation link has expired. |
| `ERR_1413` | CHAT_SHARE_FORBIDDEN | You do not have access to this shared conversation. |
| `ERR_1414` | CHAT_REPORT_DUPLICATE | You have already reported this message. |
| `ERR_1415` | CHAT_REPORT_NOT_FOUND | Report not found. |
| `ERR_1416` | CHAT_INVALID_FEEDBACK | Invalid feedback value. |
| `ERR_1417` | CHAT_GRPC_UNAVAILABLE | AI service is currently unavailable. |
| `ERR_1418` | CHAT_WORKSPACE_FAILED | Failed to create conversation workspace. |
| `ERR_1419` | CHAT_SHARE_REVOKED | This shared conversation has been revoked. |

## External Service Errors (1500-1599)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1500` | EXTERNAL_SERVICE_ERROR | External service error. |
| `ERR_1501` | AI_SERVICE_ERROR | AI service encountered an error. |
| `ERR_1502` | AI_SERVICE_TIMEOUT | AI service request timed out. |

## System Errors (1600-1699)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1600` | MAINTENANCE_MODE | System is under maintenance. Please try again later. |
| `ERR_1601` | REGISTRATION_DISABLED | User registration is currently disabled. |

## Usage / Plan Errors (1700-1799)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1700` | USAGE_LIMIT_EXCEEDED | Usage limit exceeded. Please upgrade your plan or wait for the limit to reset. |
| `ERR_1701` | USAGE_RATE_LIMITED | Rate limit exceeded. Please slow down your requests. |
| `ERR_1702` | USAGE_REQUEST_TOO_LARGE | Request exceeds maximum allowed tokens for your plan. |
| `ERR_1710` | PLAN_NOT_FOUND | Plan not found. |
| `ERR_1711` | PLAN_ALREADY_EXISTS | A plan with this slug already exists. |
| `ERR_1712` | PLAN_INACTIVE | This plan is not currently available. |
| `ERR_1713` | PLAN_INVALID | Invalid plan configuration. |
| `ERR_1714` | PLAN_UPGRADE_REQUIRED | This feature requires a plan upgrade. |
| `ERR_1715` | PLAN_FEATURE_NOT_AVAILABLE | This feature is not available on your current plan. |

## Notification Errors (1800-1899)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1800` | NOTIFICATION_NOT_FOUND | Notification not found. |
| `ERR_1801` | NOTIFICATION_FORBIDDEN | You do not have access to this notification. |
| `ERR_1802` | NOTIFICATION_INVALID_DESTINATION | Invalid notification destination. |
| `ERR_1803` | NOTIFICATION_PAYLOAD_TOO_LARGE | Notification payload exceeds maximum size. |
| `ERR_1804` | NOTIFICATION_SSE_CONNECTION_LIMIT | Maximum SSE connections per user reached. |
| `ERR_1805` | NOTIFICATION_SSE_CONNECTION_FAILED | Failed to establish SSE connection. |
| `ERR_1806` | NOTIFICATION_RATE_LIMITED | Notification rate limit exceeded. |

## Workspace Errors (1900-1999)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1900` | WORKSPACE_NOT_FOUND | Workspace not found. |
| `ERR_1901` | WORKSPACE_NAME_EXISTS | A workspace with this name already exists. |
| `ERR_1902` | WORKSPACE_FORBIDDEN | You do not have access to this workspace. |
| `ERR_1903` | WORKSPACE_ALIAS_EXISTS | A workspace with this alias already exists. |
| `ERR_1904` | WORKSPACE_MAX_LIMIT_REACHED | Maximum number of workspaces reached for your plan. |

### Workspace Settings (1910-1919)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1910` | WORKSPACE_SETTING_NOT_FOUND | Workspace setting not found. |
| `ERR_1911` | WORKSPACE_SETTING_FORBIDDEN | You do not have access to this workspace setting. |

### Workspace Documents (1920-1929)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1920` | WORKSPACE_DOCUMENT_NOT_FOUND | Document not found. |
| `ERR_1921` | WORKSPACE_DOCUMENT_FORBIDDEN | You do not have access to this document. |
| `ERR_1922` | WORKSPACE_DOCUMENT_INVALID_TYPE | File type is not allowed. |
| `ERR_1923` | WORKSPACE_DOCUMENT_UPLOAD_FAILED | Document upload failed. |
| `ERR_1924` | WORKSPACE_DOCUMENT_NOT_IN_BLOB | Document file not found in storage. |

### Workspace Storage (1930-1939)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1930` | WORKSPACE_STORAGE_QUOTA_EXCEEDED | Workspace storage quota exceeded. |
| `ERR_1931` | WORKSPACE_STORAGE_FILE_TOO_LARGE | File size exceeds maximum allowed. |

### Workspace Upload Sessions (1940-1949)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1940` | WORKSPACE_UPLOAD_SESSION_NOT_FOUND | Upload session not found. |
| `ERR_1941` | WORKSPACE_UPLOAD_SESSION_EXPIRED | Upload session has expired. |
| `ERR_1942` | WORKSPACE_UPLOAD_TOO_MANY_FILES | Too many files in upload request. |

### Document Indexing (1950-1959)

| Code | Name | Description |
|------|------|-------------|
| `ERR_1950` | INDEXING_FAILED | Document indexing failed. |
| `ERR_1951` | INDEXING_IN_PROGRESS | Document is already being indexed. |
| `ERR_1952` | INDEXING_SERVICE_UNAVAILABLE | Indexing service is not available. |

## Model Errors (2000-2099)

| Code | Name | Description |
|------|------|-------------|
| `ERR_2000` | MODEL_NOT_FOUND | Model not found. |
| `ERR_2001` | LITELLM_CONNECTION_FAILED | Failed to connect to LiteLLM service. |
| `ERR_2002` | LITELLM_SYNC_FAILED | Failed to sync models from LiteLLM. |
| `ERR_2003` | MODEL_INACTIVE | This model is currently unavailable. Please select a different model. |

## RBAC / Authorization Errors (2100-2199)

| Code | Name | Description |
|------|------|-------------|
| `ERR_2100` | ROLE_NOT_FOUND | Role not found. |
| `ERR_2101` | ROLE_ALREADY_EXISTS | A role with this name already exists. |
| `ERR_2102` | ROLE_SYSTEM_PROTECTED | System roles cannot be modified or deleted. |
| `ERR_2103` | PERMISSION_DENIED | You do not have permission to perform this action. |
| `ERR_2104` | INVALID_PERMISSION | One or more permission strings are invalid. |

## Tool Errors (2200-2299)

| Code | Name | Description |
|------|------|-------------|
| `ERR_2200` | TOOL_NOT_FOUND | Tool not found. |
| `ERR_2201` | TOOL_ALREADY_EXISTS | A tool with this name already exists. |

## Agent Type Errors (2300-2399)

| Code | Name | Description |
|------|------|-------------|
| `ERR_2300` | AGENT_TYPE_NOT_FOUND | Agent type not found. |
| `ERR_2301` | AGENT_TYPE_ALREADY_EXISTS | An agent type with this name already exists. |
| `ERR_2302` | AGENT_TYPE_IN_USE | This agent type is in use by one or more agents and cannot be deleted. |
| `ERR_2303` | AGENT_TYPE_PROMPT_NOT_FOUND | Agent type prompt not found for this model. |

## Custom Agent Errors (2400-2499)

| Code | Name | Description |
|------|------|-------------|
| `ERR_2400` | CUSTOM_AGENT_NOT_FOUND | Agent not found. |
| `ERR_2401` | CUSTOM_AGENT_ALREADY_EXISTS | An agent with this name already exists. |
| `ERR_2402` | CUSTOM_AGENT_FORBIDDEN | You do not have access to this agent. |
| `ERR_2404` | CUSTOM_AGENT_INVALID_NAME | Agent name must contain only letters, numbers, and spaces. |
| `ERR_2405` | CUSTOM_AGENT_DEFAULT_READONLY | Default agents cannot be modified by users. |

## Playbook Errors (2500-2599)

| Code | Name | Description |
|------|------|-------------|
| `ERR_2500` | PLAYBOOK_NOT_FOUND | Playbook not found. |
| `ERR_2501` | PLAYBOOK_EXECUTION_NOT_FOUND | Playbook execution not found. |
| `ERR_2502` | PLAYBOOK_EXECUTION_IN_PROGRESS | A playbook execution is already in progress. |
| `ERR_2503` | PLAYBOOK_EXECUTION_NOT_INTERRUPTED | The execution is not in an interrupted state. |
| `ERR_2504` | PLAYBOOK_EXECUTION_NO_THREAD | No thread ID found for this execution. Cannot resume. |
| `ERR_2505` | PLAYBOOK_GRPC_UNAVAILABLE | AI service for playbook execution is unavailable. |
| `ERR_2506` | PLAYBOOK_EXECUTION_FAILED | Playbook execution failed unexpectedly. |
| `ERR_2507` | PLAYBOOK_EXECUTION_TIMEOUT | Playbook execution timed out. |
| `ERR_2508` | PLAYBOOK_NO_TASKS | Playbook has no tasks to execute. |
| `ERR_2509` | PLAYBOOK_GENERATE_FAILED | Failed to generate playbook via AI. |
