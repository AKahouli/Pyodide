/** Shared Conversation V2 session status enums (no Mongoose dependency). */

export type AppBuilderSessionStatus =
  | 'active'
  | 'waiting'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

export type AppBuilderDeployStatus =
  | 'idle'
  | 'deploying'
  | 'deployed'
  | 'error';

export type AppBuilderEventTypeName =
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
