import { MessageComponent, ComponentType } from '@modules/conversation/interfaces/message.interface';

export interface WidgetSessionInfo {
  sessionId: string;
  agentId: string;
  tokenHash: string;
}

export interface WidgetStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

interface RequestWithWidget {
  widgetTokenHash?: string;
  widgetAgentId?: string;
  widgetAgent?: {
    _id: string;
    name: string;
    role: string;
    description: string;
    temperature: number;
    agentType: string;
    knowledgeBases: string[];
    tools: string[];
    skills: string[];
    disabledSkills: string[];
    connectors: string[];
    instruction?: string;
    ignorePrePrompt: boolean;
    llmModel?: string;
    isActive: boolean;
    createdBy: string;
  };
}
