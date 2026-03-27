export interface IAgentTypeResponse {
  id: string;
  name: string;
  slug: string;
  defaultPrompt: string;
  promptCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
