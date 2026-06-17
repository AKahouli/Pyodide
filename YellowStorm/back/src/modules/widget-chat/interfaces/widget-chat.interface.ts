import { Types } from 'mongoose';
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
    _id: Types.ObjectId;
    name: string;
    role: string;
    description: string;
    temperature: number;
    agentType: Types.ObjectId;
    knowledgeBases: Types.ObjectId[];
    tools: Types.ObjectId[];
    skills: Types.ObjectId[];
    disabledSkills: Types.ObjectId[];
    connectors: Types.ObjectId[];
    instruction?: string;
    ignorePrePrompt: boolean;
    llmModel?: string;
    isActive: boolean;
    createdBy: Types.ObjectId;
  };
}
