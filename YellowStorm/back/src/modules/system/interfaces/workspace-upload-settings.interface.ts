export interface WorkspaceUploadSettingsValue {
  allowedExtensions: string[];
  maxFileSizeMb?: number;
  conversationWorkspaceStorageMb?: number;
}

export interface WorkspaceUploadSettings extends WorkspaceUploadSettingsValue {
  maxFileSizeMb: number;
  conversationWorkspaceStorageMb: number;
  supportedExtensions: string[];
  updatedAt?: Date;
}
