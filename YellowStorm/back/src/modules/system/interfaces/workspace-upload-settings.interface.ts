export interface WorkspaceUploadSettingsValue {
  allowedExtensions: string[];
}

export interface WorkspaceUploadSettings extends WorkspaceUploadSettingsValue {
  supportedExtensions: string[];
  updatedAt?: Date;
}
