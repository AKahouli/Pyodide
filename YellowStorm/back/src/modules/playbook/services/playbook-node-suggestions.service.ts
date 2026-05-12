import { Injectable } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { RequestNodeSuggestionsDto } from '../dto/request-node-suggestions.dto';
import { PlaybookService } from './playbook.service';
import { PlaybookSettingsService } from './playbook-settings.service';

type SuggestionKind = 'upstream' | 'downstream' | 'validation' | 'approval' | 'trigger' | 'action' | 'split';
type SuggestionPosition = 'before' | 'after' | 'parallel';

export interface SuggestionItem {
  id: string;
  kind: SuggestionKind;
  title: string;
  description: string;
  reason: string;
  confidence: number;
  position: SuggestionPosition;
  connectsFromTaskId: string | null;
  connectsToTaskId: string | null;
}

@Injectable()
export class PlaybookNodeSuggestionsService {
  constructor(
    private readonly playbookService: PlaybookService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly playbookSettingsService: PlaybookSettingsService,
  ) {}

  async suggest(playbookId: string, taskId: string, dto: RequestNodeSuggestionsDto): Promise<NodeSuggestionsResponse> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const playbook = await this.playbookService.findById(playbookId);
    const task = playbook.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND);
    }

    const mergedTask = {
      ...task,
      title: dto.title?.trim() || task.title,
      description: dto.description?.trim() || task.description,
      expectedResult: dto.expectedResult?.trim() || task.expectedResult || null,
    };

    const model = await this.playbookSettingsService.resolveInferenceModel(playbook.designSettings);
    const effectiveSettings = await this.playbookSettingsService.resolveEffectiveSettings(playbook.designSettings);
    const context = this.buildContext(playbook, mergedTask.id);

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert workflow architect. Return JSON only with a top-level suggestions array. Keep suggestions concise, business-readable, non-duplicative, and do not mutate the current step. Each suggestion must include kind, title, description, reason, confidence, position, connectsFromTaskId, and connectsToTaskId.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            playbook: {
              id: playbook.id,
              name: playbook.name,
              description: playbook.description,
            },
            selectedTask: {
              id: mergedTask.id,
              title: mergedTask.title,
              description: mergedTask.description,
              expectedResult: mergedTask.expectedResult || null,
            },
            context,
            constraints: {
              maxSuggestions: 5,
              approvalSuggestionMode: effectiveSettings.approvalSuggestionMode,
              allowedKinds: ['upstream', 'downstream', 'validation', 'approval', 'trigger', 'action', 'split'],
              allowedPositions: ['before', 'after', 'parallel'],
            },
          }, null, 2),
        },
      ],
    }, { timeout: 45000 });

    return {
      suggestions: this.normalizeResponse(this.extractChatCompletionText(response.data), mergedTask.id),
      model,
      settings: effectiveSettings,
    };
  }

  private buildContext(playbook: Awaited<ReturnType<PlaybookService['findById']>>, taskId: string) {
    const upstreamTaskIds = playbook.edges.filter((edge) => edge.targetId === taskId).map((edge) => edge.sourceId);
    const downstreamTaskIds = playbook.edges.filter((edge) => edge.sourceId === taskId).map((edge) => edge.targetId);

    return {
      upstream: playbook.tasks
        .filter((task) => upstreamTaskIds.includes(task.id))
        .map((task) => ({ id: task.id, title: task.title, description: task.description })),
      downstream: playbook.tasks
        .filter((task) => downstreamTaskIds.includes(task.id))
        .map((task) => ({ id: task.id, title: task.title, description: task.description })),
      siblingTitles: playbook.tasks.filter((task) => task.id !== taskId).map((task) => task.title),
    };
  }

  private extractChatCompletionText(responseData: any): string {
    const content = responseData?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .join('\n')
        .trim();
    }
    return '';
  }

  private normalizeResponse(raw: string, selectedTaskId: string): SuggestionItem[] {
    try {
      const parsed = JSON.parse(raw || '{}');
      const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
      return suggestions
        .slice(0, 5)
        .map((item: any, index: number): SuggestionItem => {
          const position = this.normalizePosition(item?.position);
          return {
            id: `suggestion-${index}`,
            kind: this.normalizeKind(item?.kind),
            title: this.normalizeText(item?.title) || 'Suggested step',
            description: this.normalizeText(item?.description) || '',
            reason: this.normalizeText(item?.reason) || 'Suggested to improve workflow completeness.',
            confidence: this.normalizeConfidence(item?.confidence),
            position,
            connectsFromTaskId: this.normalizeText(item?.connectsFromTaskId) || (position === 'before' ? null : selectedTaskId),
            connectsToTaskId: this.normalizeText(item?.connectsToTaskId) || (position === 'before' ? selectedTaskId : null),
          };
        })
        .filter((item: SuggestionItem) => item.title.length > 0);
    } catch {
      return [];
    }
  }

  private normalizeKind(value: unknown): SuggestionKind {
    return value === 'upstream' || value === 'downstream' || value === 'validation' || value === 'approval' || value === 'trigger' || value === 'action' || value === 'split'
      ? value
      : 'downstream';
  }

  private normalizePosition(value: unknown): SuggestionPosition {
    return value === 'before' || value === 'after' || value === 'parallel' ? value : 'after';
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0.6;
    return Math.max(0, Math.min(1, value));
  }
}
export interface NodeSuggestionsResponse {
  suggestions: SuggestionItem[];
  model: string;
  settings: Awaited<ReturnType<PlaybookSettingsService['resolveEffectiveSettings']>>;
}
