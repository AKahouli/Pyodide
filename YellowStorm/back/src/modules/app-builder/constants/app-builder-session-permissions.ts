/** Session-scoped permissions returned by GET /sessions/:id. */
export const AppBuilderSessionPermissions = {
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

export type AppBuilderSessionPermission =
  (typeof AppBuilderSessionPermissions)[keyof typeof AppBuilderSessionPermissions];

export const APP_BUILDER_OWNER_SESSION_PERMISSIONS: AppBuilderSessionPermission[] = [
  AppBuilderSessionPermissions.SESSION_READ,
  AppBuilderSessionPermissions.EVENTS_READ,
  AppBuilderSessionPermissions.FILES_READ,
  AppBuilderSessionPermissions.WORKSPACE_DOCUMENTS_READ,
  AppBuilderSessionPermissions.SESSION_WRITE,
  AppBuilderSessionPermissions.SESSION_DELETE,
  AppBuilderSessionPermissions.STREAM_WRITE,
  AppBuilderSessionPermissions.DEPLOY_WRITE,
  AppBuilderSessionPermissions.SHARE_WRITE,
];

/** Marketplace share recipients with conversation access: same rights as owner. */
export const APP_BUILDER_SHARED_SESSION_PERMISSIONS: AppBuilderSessionPermission[] =
  APP_BUILDER_OWNER_SESSION_PERMISSIONS;

export function hasAppBuilderSessionPermission(
  permissions: readonly AppBuilderSessionPermission[],
  required: AppBuilderSessionPermission,
): boolean {
  return permissions.includes(required);
}
