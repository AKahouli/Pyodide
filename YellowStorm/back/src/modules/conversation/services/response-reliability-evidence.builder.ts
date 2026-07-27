import { Injectable } from '@nestjs/common';
import type { MessageDocument } from '../schemas/message.schema';
import type { MessageComponent } from '../interfaces/message.interface';

export const MAX_ANSWER_CHARACTERS = 30_000;
export const MAX_EVIDENCE_ITEMS = 40;
export const MAX_EVIDENCE_ITEM_CHARACTERS = 6_000;
export const MAX_TOTAL_EVIDENCE_CHARACTERS = 60_000;

export interface ReliabilityEvidenceItem {
  id: string;
  type: 'document' | 'calculation';
  parentComponentId?: string;
  source?: string;
  page?: string;
  content: string;
  workspaceId?: string;
  reference?: string;
}

export interface ReliabilityAnswerSegment {
  componentId: string;
  text: string;
  evidence: ReliabilityEvidenceItem[];
}

export interface ResponseReliabilityInput {
  requestId: string;
  messageId: string;
  question: string;
  segments: ReliabilityAnswerSegment[];
  globalEvidence: ReliabilityEvidenceItem[];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const DOCUMENT_EVIDENCE_TOOLS = new Set([
  'perform_document_search',
  'perform_filtered_search',
  'perform_standard_search',
  'preform_all_brain_search',
]);
const MAX_TOOL_RESULT_CHARACTERS = 65_536;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseToolResult(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TOOL_RESULT_CHARACTERS) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

@Injectable()
export class ResponseReliabilityEvidenceBuilder {
  build(message: MessageDocument, question: string, requestId: string): ResponseReliabilityInput {
    return this.buildFromComponents({
      messageId: message._id.toString(),
      components: (message.components ?? []) as MessageComponent[],
      question,
      requestId,
    });
  }

  buildFromComponents(input: {
    messageId: string;
    components: MessageComponent[];
    question: string;
    requestId: string;
  }): ResponseReliabilityInput {
    let answerCharacters = 0;
    const segments: ReliabilityAnswerSegment[] = [];
    const segmentById = new Map<string, ReliabilityAnswerSegment>();
    const components = Array.isArray(input.components) ? input.components : [];

    for (const [index, component] of components.entries()) {
      if (component.type !== 'text') continue;
      const text = stringValue(component.data?.content) || stringValue(component.data?.text);
      if (!text || answerCharacters >= MAX_ANSWER_CHARACTERS) continue;
      const clipped = text.slice(0, MAX_ANSWER_CHARACTERS - answerCharacters);
      answerCharacters += clipped.length;
      const componentId = stringValue(component.id) || `text-index-${index}`;
      const segment = { componentId, text: clipped, evidence: [] };
      segments.push(segment);
      segmentById.set(componentId, segment);
    }

    const globalEvidence: ReliabilityEvidenceItem[] = [];
    let totalEvidenceCharacters = 0;
    let evidenceCount = 0;
    const appendEvidence = (item: Omit<ReliabilityEvidenceItem, 'id' | 'content'> & { content: string }) => {
      if (evidenceCount >= MAX_EVIDENCE_ITEMS || totalEvidenceCharacters >= MAX_TOTAL_EVIDENCE_CHARACTERS) return;
      // Deterministic clipping bounds confidential payload size and evaluator cost.
      const content = item.content.slice(0, Math.min(
        MAX_EVIDENCE_ITEM_CHARACTERS,
        MAX_TOTAL_EVIDENCE_CHARACTERS - totalEvidenceCharacters,
      ));
      if (!content.trim()) return;
      const evidence: ReliabilityEvidenceItem = { ...item, id: `evidence-${evidenceCount}`, content };
      evidenceCount += 1;
      totalEvidenceCharacters += content.length;
      const parent = item.parentComponentId ? segmentById.get(item.parentComponentId) : undefined;
      (parent?.evidence || globalEvidence).push(evidence);
    };

    for (const component of components) {
      const data = component.data || {};
      if (component.type === 'citation') {
        const textSource = data.text_source && typeof data.text_source === 'object' ? data.text_source as Record<string, unknown> : undefined;
        const imageSource = data.image_source && typeof data.image_source === 'object' ? data.image_source as Record<string, unknown> : undefined;
        const nested = textSource || imageSource || data;
        const content = stringValue(nested.highlightText) || stringValue(nested.highlight_text)
          || stringValue(nested.pageContent) || stringValue(nested.page_content) || stringValue(nested.content);
        if (!content) continue;
        appendEvidence({
          type: 'document',
          parentComponentId: stringValue(data.parentId) || stringValue(data.parent_id),
          source: stringValue(nested.source) || stringValue(nested.fileName) || stringValue(nested.file_name) || stringValue(nested.documentName) || stringValue(nested.name),
          page: stringValue(nested.page),
          content,
          workspaceId: stringValue(nested.workspaceId) || stringValue(nested.workspace_id) || stringValue(nested.workspace_name),
          reference: stringValue(nested.reference),
        });
      }
      if (component.type === 'sandbox' && !stringValue(data.error)
        && (data.outputAvailable === true || data.output_available === true) && stringValue(data.output)) {
        const output = stringValue(data.output)!;
        appendEvidence({
          type: 'calculation',
          content: `Output:\n${output}`,
        });
      }
      if (component.type === 'toolInfo' && data.status === 'completed') {
        const toolName = stringValue(data.title);
        const parsed = parseToolResult(data.resultJson ?? data.result_json);
        if (!toolName || parsed === undefined) continue;

        if (DOCUMENT_EVIDENCE_TOOLS.has(toolName)) {
          const result = recordValue(parsed);
          const sources = Array.isArray(result?.sources_text) ? result.sources_text : [];
          for (const source of sources) {
            const item = recordValue(source);
            const content = stringValue(item?.page_content) || stringValue(item?.pageContent);
            if (!content) continue;
            appendEvidence({
              type: 'document',
              source: stringValue(item?.filename) || stringValue(item?.file_name) || stringValue(item?.source),
              page: stringValue(item?.page),
              content,
              workspaceId: stringValue(item?.workspace_id) || stringValue(item?.workspaceId),
              reference: stringValue(item?.source_reference) || stringValue(item?.reference),
            });
          }
        } else if (toolName === 'perform_web_search') {
          const result = recordValue(parsed);
          const text = stringValue(result?.text);
          const sources = Array.isArray(result?.sources) ? result.sources.map(recordValue).filter(Boolean) as Record<string, unknown>[] : [];
          const validSources = sources.filter((source) => {
            const url = stringValue(source.url);
            if (!url) return false;
            try {
              return new URL(url).protocol === 'https:';
            } catch {
              return false;
            }
          });
          if (text && validSources.length) {
            appendEvidence({
              type: 'document',
              source: stringValue(validSources[0].url),
              content: `${text}\n\nSources:\n${validSources.map((source) => {
                const title = stringValue(source.title);
                const url = stringValue(source.url)!;
                return title ? `${title}: ${url}` : url;
              }).join('\n')}`,
            });
          }
        } else if (toolName === 'calculator' && (typeof parsed === 'string' || typeof parsed === 'number')) {
          const output = String(parsed).trim();
          if (output) appendEvidence({ type: 'calculation', content: `Output:\n${output}` });
        }
      }
    }

    return { requestId: input.requestId, messageId: input.messageId, question: input.question, segments, globalEvidence };
  }
}
