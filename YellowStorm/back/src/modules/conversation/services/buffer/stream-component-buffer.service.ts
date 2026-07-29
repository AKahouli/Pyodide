import { Injectable } from '@nestjs/common';
import { MessageComponent, ComponentType } from '../../interfaces/message.interface';
import {
  getComponentType as sharedGetComponentType,
  extractComponentData as sharedExtractComponentData,
  mapTaskStatus as sharedMapTaskStatus,
} from '../../utils/component-mapper';

@Injectable()
export class StreamComponentBufferService {
  getComponentType(comp: any): ComponentType {
    return sharedGetComponentType(comp);
  }

  extractComponentData(comp: any): { type: ComponentType; data: Record<string, unknown> } {
    return sharedExtractComponentData(comp);
  }

  mapTaskStatus(status: string | undefined): string {
    return sharedMapTaskStatus(status);
  }

  parseGuardrailDecision(value?: string): Record<string, unknown> | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  applyChunkToBuffer(
    buffer: Map<string, MessageComponent>,
    action: string,
    comp: any,
    guardrailDecision?: Record<string, unknown>,
    includePrivateToolResult = false,
  ): void {
    const componentId = comp.id;
    const { type, data } = this.extractComponentData(comp);
    if (guardrailDecision) {
      data.guardrailDecision = guardrailDecision;
    }
    if (type === 'toolInfo' && !includePrivateToolResult) {
      delete data.resultJson;
      delete data.result_json;
    }

    if (action === 'add') {
      const existing = buffer.get(componentId);
      if (existing && type === 'toolInfo') {
        existing.data = this.mergeComponentData(type, existing.data, data);
        if (!includePrivateToolResult) {
          delete existing.data.resultJson;
          delete existing.data.result_json;
        }
        return;
      }
      buffer.set(componentId, {
        id: componentId,
        type,
        data: { ...data },
      });
    } else if (action === 'update') {
      const existing = buffer.get(componentId);
      if (existing) {
        existing.data = this.mergeComponentData(type, existing.data, data);
        if (type === 'toolInfo' && !includePrivateToolResult) {
          delete existing.data.resultJson;
          delete existing.data.result_json;
        }
        if (guardrailDecision) {
          existing.data.guardrailDecision = guardrailDecision;
        }
      } else if (type === 'toolInfo') {
        const merged = this.mergeComponentData(type, {}, data);
        if (!includePrivateToolResult) {
          delete merged.resultJson;
          delete merged.result_json;
        }
        buffer.set(componentId, { id: componentId, type, data: merged });
      }
    }
  }

  mergeComponentData(
    type: ComponentType,
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (type) {
      case 'text':
      case 'reasoning': {
        if (incoming.guardrailDecision) {
          return { ...existing, ...incoming };
        }
        const existingContent = (existing.content as string) || '';
        const newContent = (incoming.content as string) || '';
        return {
          ...existing,
          content: existingContent + newContent,
        };
      }
      case 'code': {
        const existingContent = (existing.content as string) || '';
        const newContent = (incoming.content as string) || '';
        return {
          ...existing,
          content: existingContent + newContent,
          language: (incoming.language as string) || existing.language,
          filename: (incoming.filename as string) || existing.filename,
        };
      }
      case 'queue':
      case 'plan':
      case 'checkpoint':
      case 'task':
      case 'chart':
      case 'sources':
      case 'webPreview':
      case 'artifact':
      case 'citation':
      case 'chainOfThought':
      case 'choice':
        return { ...incoming };
      case 'toolInfo':
        const existingStatus = (existing.status as string) || 'running';
        const incomingStatus = (incoming.status as string) || existingStatus;
        const existingIsTerminal = existingStatus === 'completed' || existingStatus === 'failed';
        return {
          title: (incoming.title as string) || (existing.title as string) || '',
          status: existingIsTerminal ? existingStatus : incomingStatus,
          params: (incoming.params as string) || (existing.params as string) || '',
          startedAt: (incoming.startedAt as string) || (existing.startedAt as string) || '',
          resultJson: (incoming.resultJson as string) || (existing.resultJson as string) || '',
        };
      case 'sandbox':
        return {
          code: (incoming.code as string) || (existing.code as string) || '',
          output: (incoming.output as string) || (existing.output as string) || '',
          error: (incoming.error as string) || (existing.error as string) || '',
          outputAvailable: incoming.outputAvailable ?? existing.outputAvailable ?? false,
        };
      default:
        return { ...existing, ...incoming };
    }
  }
}
