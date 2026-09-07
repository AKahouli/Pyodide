export type RunCodeSourceScope =
  | { kind: 'workspace' }
  | { kind: 'files'; relativePaths: string[] };

export interface RunCodeSourceDescriptor {
  workspaceId: string;
  alias: string;
  cephPrefix: string;
  scope: RunCodeSourceScope;
}

export interface RunCodeAttachmentSource {
  workspaceId: string;
  path: string;
}

export interface RunCodeWorkspaceMetadata {
  workspaceId: string;
  name: string;
  alias: string;
  cephPrefix: string;
}
