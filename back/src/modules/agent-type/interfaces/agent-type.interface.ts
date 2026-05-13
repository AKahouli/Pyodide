export interface IAgentTypeResponse {
  id: string;
  name: string;
  slug: string;
  defaultPrompt: string;
  skills?: string[];
  promptCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
