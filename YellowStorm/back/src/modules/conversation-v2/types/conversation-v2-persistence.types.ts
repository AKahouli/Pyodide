/** Shared Conversation V2 session status enums (no Mongoose dependency). */

export type ConversationV2SessionStatus =
  | 'active'
  | 'waiting'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

export type ConversationV2DeployStatus =
  | 'idle'
  | 'deploying'
  | 'deployed'
  | 'error';

export type ConversationV2EventTypeName =
  | 'message'
  | 'tool'
  | 'step'
  | 'plan'
  | 'title'
  | 'done'
  | 'wait'
  | 'error'
  | 'application_component'
  | 'app_build_progress';
