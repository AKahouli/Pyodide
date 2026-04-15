export interface ISkillFileResponse {
  path: string;
  kind: string;
  mimeType: string;
  content: string;
}

export interface ISkillResponse {
  id: string;
  name: string;
  description: string;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  instructions: string;
  files: ISkillFileResponse[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGrpcSkillFile {
  path: string;
  kind: string;
  mime_type: string;
  content: string;
}

export interface IGrpcSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowed_tools: string[];
  files: IGrpcSkillFile[];
}
