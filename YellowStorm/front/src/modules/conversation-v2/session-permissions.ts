export const ConversationV2SessionPermissions = {
  SESSION_READ: 'session.read',
  EVENTS_READ: 'events.read',
  FILES_READ: 'files.read',
  WORKSPACE_DOCUMENTS_READ: 'workspace-documents.read',
  SESSION_WRITE: 'session.write',
  SESSION_DELETE: 'session.delete',
  STREAM_WRITE: 'stream.write',
  DEPLOY_WRITE: 'deploy.write',
  SHARE_WRITE: 'share.write',
} as const;

export type ConversationV2SessionPermission =
  (typeof ConversationV2SessionPermissions)[keyof typeof ConversationV2SessionPermissions];

export type ConversationV2ViewerRole = 'owner' | 'shared';

export function hasConversationV2SessionPermission(
  permissions: readonly ConversationV2SessionPermission[] | undefined,
  required: ConversationV2SessionPermission,
): boolean {
  return permissions?.includes(required) ?? false;
}

export function canWriteConversationV2Session(
  permissions: readonly ConversationV2SessionPermission[] | undefined,
): boolean {
  return hasConversationV2SessionPermission(permissions, ConversationV2SessionPermissions.STREAM_WRITE);
}
