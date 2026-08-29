import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import type { MessageComponent, ResponseCorrectionWorkflow } from '../interfaces/message.interface';
import type { ConversationPlaybookPreviewV1, ResolvedDisplayedAnswer, TrustedConversationPlaybookContextV1 } from '../interfaces/conversation-playbook-handoff.interface';

const MAX_ITEMS = 100;
const MAX_TEXT = 500;
const MAX_CONTEXT_BYTES = 32 * 1024;

@Injectable()
export class ConversationPlaybookContextProjectorService {
  resolveDisplayedAnswer(message: { components?: MessageComponent[]; correctionWorkflow?: ResponseCorrectionWorkflow }, version: string): ResolvedDisplayedAnswer {
    if (version === 'original') return { version, components: message.components ?? [] };
    const workflow = message.correctionWorkflow;
    if (!workflow) throw new ConflictException(ErrorCode.CONFLICT, 'The selected answer version is no longer available');
    if (version === 'corrected' && workflow.status === 'corrected' && workflow.correctedComponents?.length) {
      return { version, components: workflow.correctedComponents };
    }
    if (version === 'abstention' && workflow.status === 'abstained') return { version, components: [] };
    if (version.startsWith('attempt:')) {
      const attemptId = version.slice('attempt:'.length);
      const attempt = workflow.attempts?.find((candidate) => candidate.attemptId === attemptId);
      if (attempt?.components?.length && ['accepted', 'rejected', 'failed'].includes(attempt.status)) {
        return { version: version as `attempt:${string}`, components: attempt.components };
      }
    }
    throw new ConflictException(ErrorCode.CONFLICT, 'The selected answer version is incomplete or stale');
  }

  project(messages: Array<{ conversationType: string; content?: string; components?: MessageComponent[] }>, answer: ResolvedDisplayedAnswer): { context: TrustedConversationPlaybookContextV1; preview: ConversationPlaybookPreviewV1 } {
    const omissions: Record<string, number> = {};
    const executionSummaries: TrustedConversationPlaybookContextV1['executionSummaries'] = [];
    const planSteps: TrustedConversationPlaybookContextV1['planSteps'] = [];
    const actions: TrustedConversationPlaybookContextV1['actions'] = [];
    const references: TrustedConversationPlaybookContextV1['references'] = [];
    const userGoal = this.safeText([...messages].reverse().find((message) => message.conversationType === 'user')?.content, omissions, 'userGoal');
    const answerOutline = this.safeText(answer.components
      .filter((component) => component.type === 'text')
      .map((component) => this.stringValue(component.data.content))
      .filter(Boolean)
      .join('\n'), omissions, 'answerOutline');

    for (const message of messages) {
      const components = message.components ?? [];
      for (const component of components) {
        if (component.type === 'agentActivity') {
          this.push(executionSummaries, {
            summary: this.safeText(this.stringValue(component.data.summary), omissions, 'executionSummaries') ?? '',
            status: this.safeStatus(component.data.status),
            actorLabel: this.safeText(this.stringValue(component.data.actorName), omissions, 'actorLabels'),
          }, omissions, 'executionSummaries');
        } else if (component.type === 'toolActivity') {
          this.push(actions, {
            name: this.safeText(this.stringValue(component.data.toolName), omissions, 'actions') ?? 'tool',
            label: this.safeText(this.stringValue(component.data.fallbackDisplayName ?? component.data.displayKey), omissions, 'actions'),
            kind: this.safeText(this.stringValue(component.data.renderKind), omissions, 'actions'),
            status: this.safeStatus(component.data.status),
            summary: this.safeText(this.stringValue(component.data.summary), omissions, 'actions'),
          }, omissions, 'actions');
        } else if (['plan', 'queue', 'checkpoint', 'task'].includes(component.type)) {
          const rawSteps = Array.isArray(component.data.steps) ? component.data.steps : [component.data];
          for (const raw of rawSteps) {
            if (!raw || typeof raw !== 'object') continue;
            const record = raw as Record<string, unknown>;
            const label = this.safeText(this.stringValue(record.label ?? record.title ?? record.summary ?? record.name), omissions, 'planSteps');
            if (label) this.push(planSteps, { label, status: this.safeStatus(record.status) }, omissions, 'planSteps');
          }
        } else if (component.type === 'artifact' || component.type === 'citation') {
          const label = this.safeText(this.stringValue(component.data.filename ?? component.data.fileName ?? component.data.title ?? component.data.label), omissions, 'references');
          if (label) this.push(references, { kind: component.type, label }, omissions, 'references');
        } else if (!['text', 'choice'].includes(component.type)) {
          omissions[component.type] = (omissions[component.type] ?? 0) + 1;
        }
      }
    }

    const context: TrustedConversationPlaybookContextV1 = {
      contextVersion: 1,
      userGoal,
      answerOutline,
      executionSummaries: executionSummaries.filter((item) => item.summary),
      planSteps,
      actions,
      agents: [],
      skills: [],
      references,
      projection: {
        generatedAt: new Date().toISOString(),
        sourceMessageCount: messages.length,
        includedMessageCount: messages.length,
        omissions,
      },
    };
    if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_CONTEXT_BYTES) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The selected conversation context is too large');
    }
    return {
      context,
      preview: { goal: userGoal, answerOutline, executionSummaries: context.executionSummaries, planSteps, actions, resources: references, omissions },
    };
  }

  private stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
  private safeStatus(value: unknown): string { return typeof value === 'string' && /^[a-z_ -]{1,40}$/i.test(value) ? value : 'unknown'; }
  private push<T>(items: T[], value: T, omissions: Record<string, number>, category: string): void {
    if (items.length < MAX_ITEMS) items.push(value);
    else omissions[category] = (omissions[category] ?? 0) + 1;
  }
  private safeText(value: string | undefined, omissions: Record<string, number>, category: string): string | undefined {
    const normalized = value?.replace(/https?:\/\/\S+/gi, '[omitted]')
      .replace(/(?:[A-Za-z]:\\|\/)[\w./\\-]+/g, '[omitted]')
      .replace(/\b(?:token|password|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, '[omitted]')
      .replace(/\s+/g, ' ').trim();
    if (!normalized) return undefined;
    if (normalized.length > MAX_TEXT) omissions[category] = (omissions[category] ?? 0) + 1;
    return normalized.slice(0, MAX_TEXT);
  }
}
