export const AppBuilderStudioSessionPermissions = {
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

export type AppBuilderStudioSessionPermission =
  (typeof AppBuilderStudioSessionPermissions)[keyof typeof AppBuilderStudioSessionPermissions];

export type AppBuilderStudioViewerRole = 'owner' | 'shared';

export function hasAppBuilderStudioSessionPermission(
  permissions: readonly AppBuilderStudioSessionPermission[] | undefined,
  required: AppBuilderStudioSessionPermission,
): boolean {
  return permissions?.includes(required) ?? false;
}

export function canWriteAppBuilderStudioSession(
  permissions: readonly AppBuilderStudioSessionPermission[] | undefined,
): boolean {
  return hasAppBuilderStudioSessionPermission(permissions, AppBuilderStudioSessionPermissions.STREAM_WRITE);
}
