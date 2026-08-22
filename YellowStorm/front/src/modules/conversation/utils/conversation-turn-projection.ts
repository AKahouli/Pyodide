import type { MessageComponent } from '../types';
import { formatSanitizedToolText } from './tool-activity';

export interface ReasoningActivityNode {
  key: string;
  type: 'reasoning';
  content: string;
  duration?: number;
  streaming: boolean;
}

export interface ToolActivityNode {
  key: string;
  type: 'tool';
  componentId: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  params?: string;
  resultJson?: string;
  startedAt?: string;
}

export type ConversationActivityNode = ReasoningActivityNode | ToolActivityNode;

export interface ArtifactActivityNode {
  key: string;
  type: 'artifact';
  filename: string;
  filePath: string;
}

export interface ConversationTurnProjection {
  activity: ConversationActivityNode[];
  answerComponents: MessageComponent[];
  artifacts: ArtifactActivityNode[];
}

function componentKey(messageId: string, component: MessageComponent, index: number): string {
  return `${messageId}:${component.id || `${component.type}:${index}`}`;
}

export function projectConversationTurn(
  messageId: string,
  components: readonly MessageComponent[],
  answerComponents: readonly MessageComponent[] = components,
  streaming = false,
): ConversationTurnProjection {
  const activity = components.flatMap<ConversationActivityNode>((component, index) => {
    const key = componentKey(messageId, component, index);
    if (component.type === 'reasoning') {
      const content = typeof component.data.content === 'string' ? component.data.content.trim() : '';
      if (!content) return [];
      return [{ key, type: 'reasoning', content, duration: typeof component.data.duration === 'number' ? component.data.duration : undefined, streaming }];
    }
    if (component.type === 'chainOfThought') {
      const steps = Array.isArray(component.data.steps)
        ? component.data.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
        : [];
      if (!steps.length) return [];
      return [{ key, type: 'reasoning', content: steps.join('\n'), streaming }];
    }
    if (component.type !== 'toolInfo') return [];
    const status = component.data.status;
    const rawResult = component.data.resultJson ?? component.data.result_json;
    return [{
      key,
      type: 'tool',
      componentId: component.id || key,
      title: typeof component.data.title === 'string' ? component.data.title : '',
      status: status === 'completed' || status === 'failed' ? status : 'running',
      params: formatSanitizedToolText(typeof component.data.params === 'string' ? component.data.params : undefined),
      resultJson: formatSanitizedToolText(typeof rawResult === 'string' ? rawResult : undefined),
      startedAt: typeof component.data.startedAt === 'string' ? component.data.startedAt : undefined,
    }];
  });

  const answer: MessageComponent[] = [];
  const artifacts: ArtifactActivityNode[] = [];
  answerComponents.forEach((component, index) => {
    if (component.type === 'reasoning' || component.type === 'chainOfThought' || component.type === 'toolInfo') return;
    if (component.type === 'artifact') {
      artifacts.push({
        key: componentKey(messageId, component, index),
        type: 'artifact',
        filename: typeof component.data.filename === 'string' ? component.data.filename : '',
        filePath: typeof component.data.filePath === 'string'
          ? component.data.filePath
          : typeof component.data.file_path === 'string' ? component.data.file_path : '',
      });
      return;
    }
    answer.push(component);
  });

  return { activity, answerComponents: answer, artifacts };
}
