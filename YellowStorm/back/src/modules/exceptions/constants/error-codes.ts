export enum ErrorCode {
  // General errors (1000-1099)
  INTERNAL_ERROR = 'ERR_1000',
  VALIDATION_ERROR = 'ERR_1001',
  NOT_FOUND = 'ERR_1002',
  UNAUTHORIZED = 'ERR_1003',
  FORBIDDEN = 'ERR_1004',
  CONFLICT = 'ERR_1005',
  BAD_REQUEST = 'ERR_1006',
  TOO_MANY_REQUESTS = 'ERR_1007',
  SERVICE_UNAVAILABLE = 'ERR_1008',

  // Authentication errors (1100-1199)
  AUTH_INVALID_CREDENTIALS = 'ERR_1100',
  AUTH_TOKEN_EXPIRED = 'ERR_1101',
  AUTH_TOKEN_INVALID = 'ERR_1102',
  AUTH_SESSION_EXPIRED = 'ERR_1103',
  AUTH_EMAIL_NOT_VERIFIED = 'ERR_1104',
  AUTH_PROFILE_INCOMPLETE = 'ERR_1105',
  AUTH_SESSION_NOT_FOUND = 'ERR_1106',
  AUTH_REFRESH_TOKEN_INVALID = 'ERR_1107',
  AUTH_REFRESH_TOKEN_EXPIRED = 'ERR_1108',
  AUTH_MICROSOFT_AUTH_FAILED = 'ERR_1109',
  AUTH_ACCOUNT_SUSPENDED = 'ERR_1110',
  INVALID_CREDENTIALS = 'ERR_1111',
  INVALID_TOKEN = 'ERR_1112',
  AUTH_SESSION_REVOKED = 'ERR_1113',
  VERIFICATION_TOKEN_EXPIRED = 'ERR_1114',
  EMAIL_ALREADY_VERIFIED = 'ERR_1115',
  AUTH_RESET_TOKEN_INVALID = 'ERR_1116',
  AUTH_RESET_TOKEN_EXPIRED = 'ERR_1117',

  // User errors (1200-1299)
  USER_NOT_FOUND = 'ERR_1200',
  USER_ALREADY_EXISTS = 'ERR_1201',
  USER_INACTIVE = 'ERR_1202',

  // Agent errors (1300-1399)
  AGENT_NOT_FOUND = 'ERR_1300',
  AGENT_UNAVAILABLE = 'ERR_1301',
  AGENT_LIMIT_REACHED = 'ERR_1302',

  // Chat errors (1400-1499)
  CHAT_NOT_FOUND = 'ERR_1400',
  CHAT_MESSAGE_TOO_LONG = 'ERR_1401',
  CHAT_RATE_LIMITED = 'ERR_1402',
  CHAT_FORBIDDEN = 'ERR_1403',
  CHAT_STREAM_LIMIT = 'ERR_1405',
  CHAT_STREAM_FAILED = 'ERR_1406',
  CHAT_STREAM_TIMEOUT = 'ERR_1407',
  CHAT_MESSAGE_NOT_FOUND = 'ERR_1408',
  CHAT_ALREADY_STREAMING = 'ERR_1409',
  CHAT_FILE_UPLOAD_LIMIT = 'ERR_1410',
  CHAT_SHARE_NOT_FOUND = 'ERR_1411',
  CHAT_SHARE_EXPIRED = 'ERR_1412',
  CHAT_SHARE_FORBIDDEN = 'ERR_1413',
  CHAT_REPORT_DUPLICATE = 'ERR_1414',
  CHAT_REPORT_NOT_FOUND = 'ERR_1415',
  CHAT_INVALID_FEEDBACK = 'ERR_1416',
  CHAT_GRPC_UNAVAILABLE = 'ERR_1417',
  CHAT_WORKSPACE_FAILED = 'ERR_1418',
  CHAT_SHARE_REVOKED = 'ERR_1419',

  // External service errors (1500-1599)
  EXTERNAL_SERVICE_ERROR = 'ERR_1500',
  AI_SERVICE_ERROR = 'ERR_1501',
  AI_SERVICE_TIMEOUT = 'ERR_1502',

  // System errors (1600-1699)
  MAINTENANCE_MODE = 'ERR_1600',
  REGISTRATION_DISABLED = 'ERR_1601',

  // Usage/Plan errors (1700-1799)
  USAGE_LIMIT_EXCEEDED = 'ERR_1700',
  USAGE_RATE_LIMITED = 'ERR_1701',
  USAGE_REQUEST_TOO_LARGE = 'ERR_1702',
  PLAN_NOT_FOUND = 'ERR_1710',
  PLAN_ALREADY_EXISTS = 'ERR_1711',
  PLAN_INACTIVE = 'ERR_1712',
  PLAN_INVALID = 'ERR_1713',
  PLAN_UPGRADE_REQUIRED = 'ERR_1714',
  PLAN_FEATURE_NOT_AVAILABLE = 'ERR_1715',

  // Notification errors (1800-1899)
  NOTIFICATION_NOT_FOUND = 'ERR_1800',
  NOTIFICATION_FORBIDDEN = 'ERR_1801',
  NOTIFICATION_INVALID_DESTINATION = 'ERR_1802',
  NOTIFICATION_PAYLOAD_TOO_LARGE = 'ERR_1803',
  NOTIFICATION_SSE_CONNECTION_LIMIT = 'ERR_1804',
  NOTIFICATION_SSE_CONNECTION_FAILED = 'ERR_1805',
  NOTIFICATION_RATE_LIMITED = 'ERR_1806',

  // Workspace errors (1900-1999)
  WORKSPACE_NOT_FOUND = 'ERR_1900',
  WORKSPACE_NAME_EXISTS = 'ERR_1901',
  WORKSPACE_FORBIDDEN = 'ERR_1902',
  WORKSPACE_ALIAS_EXISTS = 'ERR_1903',
  WORKSPACE_MAX_LIMIT_REACHED = 'ERR_1904',

  // Workspace Setting errors (1910-1919)
  WORKSPACE_SETTING_NOT_FOUND = 'ERR_1910',
  WORKSPACE_SETTING_FORBIDDEN = 'ERR_1911',

  // Workspace Document errors (1920-1929)
  WORKSPACE_DOCUMENT_NOT_FOUND = 'ERR_1920',
  WORKSPACE_DOCUMENT_FORBIDDEN = 'ERR_1921',
  WORKSPACE_DOCUMENT_INVALID_TYPE = 'ERR_1922',
  WORKSPACE_DOCUMENT_UPLOAD_FAILED = 'ERR_1923',
  WORKSPACE_DOCUMENT_NOT_IN_BLOB = 'ERR_1924',

  // Workspace Storage errors (1930-1939)
  WORKSPACE_STORAGE_QUOTA_EXCEEDED = 'ERR_1930',
  WORKSPACE_STORAGE_FILE_TOO_LARGE = 'ERR_1931',

  // Workspace Upload Session errors (1940-1949)
  WORKSPACE_UPLOAD_SESSION_NOT_FOUND = 'ERR_1940',
  WORKSPACE_UPLOAD_SESSION_EXPIRED = 'ERR_1941',
  WORKSPACE_UPLOAD_TOO_MANY_FILES = 'ERR_1942',

  // Document Indexing errors (1950-1959)
  INDEXING_FAILED = 'ERR_1950',
  INDEXING_IN_PROGRESS = 'ERR_1951',
  INDEXING_SERVICE_UNAVAILABLE = 'ERR_1952',

  // Auth token missing (for SSE)
  AUTH_TOKEN_MISSING = 'ERR_1120',

  // OAuth errors (1121-1129)
  AUTH_OAUTH_FAILED = 'ERR_1121',
  AUTH_OAUTH_STATE_INVALID = 'ERR_1122',
  AUTH_OAUTH_EMAIL_MISSING = 'ERR_1123',
  AUTH_OAUTH_LINK_REQUIRED = 'ERR_1124',
  AUTH_OAUTH_LINK_TOKEN_INVALID = 'ERR_1125',
  AUTH_OAUTH_LINK_TOKEN_EXPIRED = 'ERR_1126',
  AUTH_OAUTH_PROVIDER_DISABLED = 'ERR_1127',
  AUTH_OAUTH_PROVIDER_NOT_FOUND = 'ERR_1128',
  AUTH_OAUTH_ACCOUNT_ALREADY_LINKED = 'ERR_1129',

  // Models errors (2000-2099)
  MODEL_NOT_FOUND = 'ERR_2000',
  MODEL_INACTIVE = 'ERR_2003',
  LITELLM_CONNECTION_FAILED = 'ERR_2001',
  LITELLM_SYNC_FAILED = 'ERR_2002',

  // RBAC/Authorization errors (2100-2199)
  ROLE_NOT_FOUND = 'ERR_2100',
  ROLE_ALREADY_EXISTS = 'ERR_2101',
  ROLE_SYSTEM_PROTECTED = 'ERR_2102',
  PERMISSION_DENIED = 'ERR_2103',
  INVALID_PERMISSION = 'ERR_2104',

  // Tool errors (2200-2299)
  TOOL_NOT_FOUND = 'ERR_2200',
  TOOL_ALREADY_EXISTS = 'ERR_2201',

  // Skill errors (2250-2299)
  SKILL_NOT_FOUND = 'ERR_2250',
  SKILL_ALREADY_EXISTS = 'ERR_2251',

  // Agent Type errors (2300-2399)
  AGENT_TYPE_NOT_FOUND = 'ERR_2300',
  AGENT_TYPE_ALREADY_EXISTS = 'ERR_2301',
  AGENT_TYPE_IN_USE = 'ERR_2302',
  AGENT_TYPE_PROMPT_NOT_FOUND = 'ERR_2303',

  // Custom Agent errors (2400-2499)
  CUSTOM_AGENT_NOT_FOUND = 'ERR_2400',
  CUSTOM_AGENT_ALREADY_EXISTS = 'ERR_2401',
  CUSTOM_AGENT_FORBIDDEN = 'ERR_2402',
  CUSTOM_AGENT_INVALID_NAME = 'ERR_2404',
  CUSTOM_AGENT_DEFAULT_READONLY = 'ERR_2405',

  // Playbook errors (2500-2599)
  PLAYBOOK_NOT_FOUND = 'ERR_2500',
  PLAYBOOK_EXECUTION_NOT_FOUND = 'ERR_2501',
  PLAYBOOK_TASK_NOT_FOUND = 'ERR_2510',
  PLAYBOOK_EXECUTION_IN_PROGRESS = 'ERR_2502',
  PLAYBOOK_EXECUTION_NOT_INTERRUPTED = 'ERR_2503',
  PLAYBOOK_EXECUTION_NO_THREAD = 'ERR_2504',
  PLAYBOOK_GRPC_UNAVAILABLE = 'ERR_2505',
  PLAYBOOK_EXECUTION_FAILED = 'ERR_2506',
  PLAYBOOK_EXECUTION_TIMEOUT = 'ERR_2507',
  PLAYBOOK_NO_TASKS = 'ERR_2508',
  PLAYBOOK_GENERATE_FAILED = 'ERR_2509',

  // Auth Provider errors (2600-2699)
  AUTH_PROVIDER_NOT_FOUND = 'ERR_2600',
  AUTH_PROVIDER_ALREADY_EXISTS = 'ERR_2601',
  AUTH_PROVIDER_IN_USE = 'ERR_2603',
  // Connector errors (3100-3199)
  CONNECTOR_NOT_FOUND = 'ERR_3100',
  CONNECTOR_ALREADY_EXISTS = 'ERR_3101',
  CONNECTOR_CREDENTIAL_NOT_FOUND = 'ERR_3110',

  // Connected App errors (3000-3099)
  CONNECTED_APP_NOT_FOUND = 'ERR_3000',
  CONNECTED_APP_ALREADY_EXISTS = 'ERR_3001',
  CONNECTED_APP_NOT_CONNECTED = 'ERR_3002',
  CONNECTED_APP_OAUTH_STATE_INVALID = 'ERR_3003',
  CONNECTED_APP_OAUTH_FAILED = 'ERR_3004',
  CONNECTED_APP_TOKEN_REFRESH_FAILED = 'ERR_3005',
  CONNECTED_APP_DISABLED = 'ERR_3007',
}

export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred. Please try again later.',
  [ErrorCode.VALIDATION_ERROR]: 'The provided data is invalid.',
  [ErrorCode.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCode.UNAUTHORIZED]: 'Authentication is required to access this resource.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to access this resource.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state.',
  [ErrorCode.BAD_REQUEST]: 'The request could not be understood.',
  [ErrorCode.TOO_MANY_REQUESTS]: 'Too many requests. Please slow down.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable.',

  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Invalid email or password.',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: 'Your session has expired. Please sign in again.',
  [ErrorCode.AUTH_TOKEN_INVALID]: 'Invalid authentication token.',
  [ErrorCode.AUTH_SESSION_EXPIRED]: 'Your session has expired.',
  [ErrorCode.AUTH_EMAIL_NOT_VERIFIED]: 'Please verify your email address.',
  [ErrorCode.AUTH_PROFILE_INCOMPLETE]: 'Please complete your profile.',
  [ErrorCode.AUTH_SESSION_NOT_FOUND]: 'Session not found.',
  [ErrorCode.AUTH_REFRESH_TOKEN_INVALID]: 'Invalid refresh token.',
  [ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED]: 'Refresh token has expired.',
  [ErrorCode.AUTH_MICROSOFT_AUTH_FAILED]: 'Microsoft authentication failed.',
  [ErrorCode.AUTH_ACCOUNT_SUSPENDED]: 'Your account has been suspended.',
  [ErrorCode.INVALID_CREDENTIALS]: 'Invalid email or password.',
  [ErrorCode.INVALID_TOKEN]: 'Invalid token.',
  [ErrorCode.AUTH_SESSION_REVOKED]: 'Your session has been revoked. Please sign in again.',
  [ErrorCode.VERIFICATION_TOKEN_EXPIRED]: 'Verification token has expired.',
  [ErrorCode.EMAIL_ALREADY_VERIFIED]: 'Email is already verified.',
  [ErrorCode.AUTH_RESET_TOKEN_INVALID]: 'The password reset link is invalid or has already been used.',
  [ErrorCode.AUTH_RESET_TOKEN_EXPIRED]: 'The password reset link has expired. Please request a new one.',

  [ErrorCode.USER_NOT_FOUND]: 'User not found.',
  [ErrorCode.USER_ALREADY_EXISTS]: 'A user with this email already exists.',
  [ErrorCode.USER_INACTIVE]: 'This account has been deactivated.',

  [ErrorCode.AGENT_NOT_FOUND]: 'Agent not found.',
  [ErrorCode.AGENT_UNAVAILABLE]: 'This agent is currently unavailable.',
  [ErrorCode.AGENT_LIMIT_REACHED]: 'Agent usage limit reached.',

  [ErrorCode.CHAT_NOT_FOUND]: 'Chat conversation not found.',
  [ErrorCode.CHAT_MESSAGE_TOO_LONG]: 'Message exceeds maximum length.',
  [ErrorCode.CHAT_RATE_LIMITED]: 'Message rate limit exceeded. Please wait.',
  [ErrorCode.CHAT_FORBIDDEN]: 'You do not have access to this conversation.',
  [ErrorCode.CHAT_STREAM_LIMIT]: 'Maximum concurrent streams reached.',
  [ErrorCode.CHAT_STREAM_FAILED]: 'AI stream failed unexpectedly.',
  [ErrorCode.CHAT_STREAM_TIMEOUT]: 'AI stream timed out.',
  [ErrorCode.CHAT_MESSAGE_NOT_FOUND]: 'Message not found.',
  [ErrorCode.CHAT_ALREADY_STREAMING]: 'This conversation is already streaming.',
  [ErrorCode.CHAT_FILE_UPLOAD_LIMIT]: 'Maximum files per message exceeded.',
  [ErrorCode.CHAT_SHARE_NOT_FOUND]: 'Shared conversation not found.',
  [ErrorCode.CHAT_SHARE_EXPIRED]: 'Shared conversation link has expired.',
  [ErrorCode.CHAT_SHARE_FORBIDDEN]: 'You do not have access to this shared conversation.',
  [ErrorCode.CHAT_REPORT_DUPLICATE]: 'You have already reported this message.',
  [ErrorCode.CHAT_REPORT_NOT_FOUND]: 'Report not found.',
  [ErrorCode.CHAT_INVALID_FEEDBACK]: 'Invalid feedback value.',
  [ErrorCode.CHAT_GRPC_UNAVAILABLE]: 'AI service is currently unavailable.',
  [ErrorCode.CHAT_WORKSPACE_FAILED]: 'Failed to create conversation workspace.',
  [ErrorCode.CHAT_SHARE_REVOKED]: 'This shared conversation has been revoked.',

  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 'External service error.',
  [ErrorCode.AI_SERVICE_ERROR]: 'AI service encountered an error.',
  [ErrorCode.AI_SERVICE_TIMEOUT]: 'AI service request timed out.',

  [ErrorCode.MAINTENANCE_MODE]: 'System is under maintenance. Please try again later.',
  [ErrorCode.REGISTRATION_DISABLED]: 'User registration is currently disabled.',

  [ErrorCode.USAGE_LIMIT_EXCEEDED]: 'Usage limit exceeded. Please upgrade your plan or wait for the limit to reset.',
  [ErrorCode.USAGE_RATE_LIMITED]: 'Rate limit exceeded. Please slow down your requests.',
  [ErrorCode.USAGE_REQUEST_TOO_LARGE]: 'Request exceeds maximum allowed tokens for your plan.',
  [ErrorCode.PLAN_NOT_FOUND]: 'Plan not found.',
  [ErrorCode.PLAN_ALREADY_EXISTS]: 'A plan with this slug already exists.',
  [ErrorCode.PLAN_INACTIVE]: 'This plan is not currently available.',
  [ErrorCode.PLAN_INVALID]: 'Invalid plan configuration.',
  [ErrorCode.PLAN_UPGRADE_REQUIRED]: 'This feature requires a plan upgrade.',
  [ErrorCode.PLAN_FEATURE_NOT_AVAILABLE]: 'This feature is not available on your current plan.',

  [ErrorCode.NOTIFICATION_NOT_FOUND]: 'Notification not found.',
  [ErrorCode.NOTIFICATION_FORBIDDEN]: 'You do not have access to this notification.',
  [ErrorCode.NOTIFICATION_INVALID_DESTINATION]: 'Invalid notification destination.',
  [ErrorCode.NOTIFICATION_PAYLOAD_TOO_LARGE]: 'Notification payload exceeds maximum size.',
  [ErrorCode.NOTIFICATION_SSE_CONNECTION_LIMIT]: 'Maximum SSE connections per user reached.',
  [ErrorCode.NOTIFICATION_SSE_CONNECTION_FAILED]: 'Failed to establish SSE connection.',
  [ErrorCode.NOTIFICATION_RATE_LIMITED]: 'Notification rate limit exceeded.',

  [ErrorCode.WORKSPACE_NOT_FOUND]: 'Workspace not found.',
  [ErrorCode.WORKSPACE_NAME_EXISTS]: 'A workspace with this name already exists.',
  [ErrorCode.WORKSPACE_FORBIDDEN]: 'You do not have access to this workspace.',
  [ErrorCode.WORKSPACE_ALIAS_EXISTS]: 'A workspace with this alias already exists.',
  [ErrorCode.WORKSPACE_MAX_LIMIT_REACHED]: 'Maximum number of workspaces reached for your plan.',

  [ErrorCode.WORKSPACE_SETTING_NOT_FOUND]: 'Workspace setting not found.',
  [ErrorCode.WORKSPACE_SETTING_FORBIDDEN]: 'You do not have access to this workspace setting.',

  [ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND]: 'Document not found.',
  [ErrorCode.WORKSPACE_DOCUMENT_FORBIDDEN]: 'You do not have access to this document.',
  [ErrorCode.WORKSPACE_DOCUMENT_INVALID_TYPE]: 'File type is not allowed.',
  [ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED]: 'Document upload failed.',
  [ErrorCode.WORKSPACE_DOCUMENT_NOT_IN_BLOB]: 'Document file not found in storage.',

  [ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED]: 'Workspace storage quota exceeded.',
  [ErrorCode.WORKSPACE_STORAGE_FILE_TOO_LARGE]: 'File size exceeds maximum allowed.',

  [ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND]: 'Upload session not found.',
  [ErrorCode.WORKSPACE_UPLOAD_SESSION_EXPIRED]: 'Upload session has expired.',
  [ErrorCode.WORKSPACE_UPLOAD_TOO_MANY_FILES]: 'Too many files in upload request.',

  [ErrorCode.INDEXING_FAILED]: 'Document indexing failed.',
  [ErrorCode.INDEXING_IN_PROGRESS]: 'Document is already being indexed.',
  [ErrorCode.INDEXING_SERVICE_UNAVAILABLE]: 'Indexing service is not available.',

  [ErrorCode.AUTH_TOKEN_MISSING]: 'Authentication token is required.',

  [ErrorCode.AUTH_OAUTH_FAILED]: 'OAuth authentication failed.',
  [ErrorCode.AUTH_OAUTH_STATE_INVALID]: 'Invalid or expired OAuth state. Please try again.',
  [ErrorCode.AUTH_OAUTH_EMAIL_MISSING]: 'The OAuth provider did not return an email address.',
  [ErrorCode.AUTH_OAUTH_LINK_REQUIRED]: 'An account with this email already exists. Check your email to link your account.',
  [ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID]: 'Invalid account linking token.',
  [ErrorCode.AUTH_OAUTH_LINK_TOKEN_EXPIRED]: 'Account linking token has expired. Please try logging in again.',
  [ErrorCode.AUTH_OAUTH_PROVIDER_DISABLED]: 'This authentication provider is currently disabled.',
  [ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND]: 'Authentication provider not found.',
  [ErrorCode.AUTH_OAUTH_ACCOUNT_ALREADY_LINKED]: 'This provider account is already linked to another user.',

  [ErrorCode.MODEL_NOT_FOUND]: 'Model not found.',
  [ErrorCode.MODEL_INACTIVE]: 'This model is currently unavailable. Please select a different model.',
  [ErrorCode.LITELLM_CONNECTION_FAILED]: 'Failed to connect to LiteLLM service.',
  [ErrorCode.LITELLM_SYNC_FAILED]: 'Failed to sync models from LiteLLM.',

  [ErrorCode.ROLE_NOT_FOUND]: 'Role not found.',
  [ErrorCode.ROLE_ALREADY_EXISTS]: 'A role with this name already exists.',
  [ErrorCode.ROLE_SYSTEM_PROTECTED]: 'System roles cannot be modified or deleted.',
  [ErrorCode.PERMISSION_DENIED]: 'You do not have permission to perform this action.',
  [ErrorCode.INVALID_PERMISSION]: 'One or more permission strings are invalid.',

  [ErrorCode.TOOL_NOT_FOUND]: 'Tool not found.',
  [ErrorCode.TOOL_ALREADY_EXISTS]: 'A tool with this name already exists.',
  [ErrorCode.SKILL_NOT_FOUND]: 'Skill not found.',
  [ErrorCode.SKILL_ALREADY_EXISTS]: 'A skill with this name already exists.',

  [ErrorCode.AGENT_TYPE_NOT_FOUND]: 'Agent type not found.',
  [ErrorCode.AGENT_TYPE_ALREADY_EXISTS]: 'An agent type with this name already exists.',
  [ErrorCode.AGENT_TYPE_IN_USE]: 'This agent type is in use by one or more agents and cannot be deleted.',
  [ErrorCode.AGENT_TYPE_PROMPT_NOT_FOUND]: 'Agent type prompt not found for this model.',

  [ErrorCode.CUSTOM_AGENT_NOT_FOUND]: 'Agent not found.',
  [ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS]: 'An agent with this name already exists.',
  [ErrorCode.CUSTOM_AGENT_FORBIDDEN]: 'You do not have access to this agent.',
  [ErrorCode.CUSTOM_AGENT_INVALID_NAME]: 'Agent name must contain only letters, numbers, and spaces.',
  [ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY]: 'Default agents cannot be modified by users.',

  [ErrorCode.PLAYBOOK_NOT_FOUND]: 'Playbook not found.',
  [ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND]: 'Playbook execution not found.',
  [ErrorCode.PLAYBOOK_TASK_NOT_FOUND]: 'Playbook task not found.',
  [ErrorCode.PLAYBOOK_EXECUTION_IN_PROGRESS]: 'This playbook already has an execution in progress.',
  [ErrorCode.PLAYBOOK_EXECUTION_NOT_INTERRUPTED]: 'Execution is not in an interrupted state.',
  [ErrorCode.PLAYBOOK_EXECUTION_NO_THREAD]: 'No thread ID available for resuming execution.',
  [ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE]: 'AI service is currently unavailable for playbook execution.',
  [ErrorCode.PLAYBOOK_EXECUTION_FAILED]: 'Playbook execution failed.',
  [ErrorCode.PLAYBOOK_EXECUTION_TIMEOUT]: 'Playbook execution timed out due to inactivity.',
  [ErrorCode.PLAYBOOK_NO_TASKS]: 'Playbook has no tasks to execute.',
  [ErrorCode.PLAYBOOK_GENERATE_FAILED]: 'Failed to generate playbook.',

  [ErrorCode.AUTH_PROVIDER_NOT_FOUND]: 'Authentication provider not found.',
  [ErrorCode.AUTH_PROVIDER_ALREADY_EXISTS]: 'An authentication provider with this key already exists.',
  [ErrorCode.AUTH_PROVIDER_IN_USE]: 'This authentication provider is in use and cannot be deleted.',
  [ErrorCode.CONNECTED_APP_NOT_FOUND]: 'Connected app not found.',
  [ErrorCode.CONNECTED_APP_ALREADY_EXISTS]: 'A connected app with this key already exists.',
  [ErrorCode.CONNECTED_APP_NOT_CONNECTED]: 'User is not connected to this app.',
  [ErrorCode.CONNECTED_APP_OAUTH_STATE_INVALID]: 'Invalid or expired OAuth state. Please try again.',
  [ErrorCode.CONNECTED_APP_OAUTH_FAILED]: 'OAuth authentication with the app failed.',
  [ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED]: 'Failed to refresh app token. Please reconnect.',
  [ErrorCode.CONNECTED_APP_DISABLED]: 'This connected app is currently disabled.',

  [ErrorCode.CONNECTOR_NOT_FOUND]: 'Connector not found.',
  [ErrorCode.CONNECTOR_ALREADY_EXISTS]: 'A connector with this slug already exists.',
  [ErrorCode.CONNECTOR_CREDENTIAL_NOT_FOUND]: 'Connector credential not found.',
};
