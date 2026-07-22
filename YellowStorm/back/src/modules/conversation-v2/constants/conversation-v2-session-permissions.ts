/** Session-scoped permissions returned by GET /sessions/:id. */
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

export const CONVERSATION_V2_OWNER_SESSION_PERMISSIONS: ConversationV2SessionPermission[] = [
  ConversationV2SessionPermissions.SESSION_READ,
  ConversationV2SessionPermissions.EVENTS_READ,
  ConversationV2SessionPermissions.FILES_READ,
  ConversationV2SessionPermissions.WORKSPACE_DOCUMENTS_READ,
  ConversationV2SessionPermissions.SESSION_WRITE,
  ConversationV2SessionPermissions.SESSION_DELETE,
  ConversationV2SessionPermissions.STREAM_WRITE,
  ConversationV2SessionPermissions.DEPLOY_WRITE,
  ConversationV2SessionPermissions.SHARE_WRITE,
];

/** Marketplace share recipients: read-only conversation access. */
export const CONVERSATION_V2_SHARED_SESSION_PERMISSIONS: ConversationV2SessionPermission[] = [
  ConversationV2SessionPermissions.SESSION_READ,
  ConversationV2SessionPermissions.EVENTS_READ,
  ConversationV2SessionPermissions.FILES_READ,
  ConversationV2SessionPermissions.WORKSPACE_DOCUMENTS_READ,
];

export function hasConversationV2SessionPermission(
  permissions: readonly ConversationV2SessionPermission[],
  required: ConversationV2SessionPermission,
): boolean {
  return permissions.includes(required);
}
