import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { isObjectId } from '@common/postgres';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { searchAccessibleFiles } from '@modules/workspace/services/search-accessible-files';
import { PlaybookAssistantRequestRepository, type PlaybookAssistantRequestRecord } from '../persistence/assistant-request.repository';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import type { ChoosePlaybookClarificationSourcesDto } from '../dto/playbook-assistant.dto';
import {
  isSourceQuestion,
  resourcePicksOf,
  type ClarificationQuestionLike,
  type PickedResource,
  type ResourcePick,
} from './playbook-assistant-sources.util';

const MAX_RESOURCES = 20;

/**
 * The person's side of the source questions the assistant asks while it designs a playbook: the questions
 * waiting for an answer, the workspaces and files chosen for them (by name), and the search used to find
 * files across every workspace the person can open. The assistant only continues the clarification.
 */
@Injectable()
export class PlaybookAssistantSourcesService {
  constructor(
    private readonly requests: PlaybookAssistantRequestRepository,
    private readonly flows: PlaybookFlowService,
    private readonly workspaces: WorkspaceService,
    private readonly workspaceShares: WorkspaceShareService,
    private readonly documents: WorkspaceDocumentService,
  ) {}

  async getSources(userId: string, continuationId: string) {
    const request = await this.waiting(continuationId, userId);
    const picks = resourcePicksOf(request.assessment);
    return {
      playbookName: await this.playbookName(request, userId),
      questions: this.sourceQuestions(request).map((question) => ({
        id: question.id,
        question: question.question ?? '',
        reason: typeof question.reason === 'string' ? question.reason : '',
        required: question.required !== false,
        selector: question.resourceSelector,
        choices: Array.isArray(question.choices) ? question.choices.filter((choice): choice is string => typeof choice === 'string') : [],
        choice: this.describe(picks[question.id]),
      })),
    };
  }

  /** The waiting Yellowmind clarifications on this playbook that ask for sources, so the designer can show them. */
  async pendingForPlaybook(userId: string, playbookId: string) {
    if (!isObjectId(playbookId)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Choose a playbook');
    const flow = await this.flows.findOneBase(playbookId, userId);
    const requests = await this.requests.findAwaitingForPlaybook(playbookId, userId);
    return {
      items: requests
        .filter((request) => request.continuationId && this.sourceQuestions(request).length > 0)
        .map((request) => ({ continuationId: request.continuationId!, playbookName: flow.name })),
    };
  }

  async choose(userId: string, continuationId: string, questionId: string, dto: ChoosePlaybookClarificationSourcesDto) {
    const request = await this.waiting(continuationId, userId);
    const question = this.sourceQuestions(request).find((candidate) => candidate.id === questionId);
    if (!question) throw new NotFoundException(ErrorCode.NOT_FOUND, 'This question does not ask for a source');
    const resources = dto.resources ?? [];
    let pick: ResourcePick | null;
    if (dto.skip) {
      pick = { skipped: true };
    } else if (dto.choice !== undefined) {
      // One of the question's own answers that is not a workspace or a file ("SharePoint", "Pasted at launch").
      if (!question.choices?.includes(dto.choice)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This is not one of the answers of the question');
      pick = { choice: dto.choice };
    } else if (!resources.length) {
      pick = null;
    } else {
      if (resources.length > MAX_RESOURCES) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `Choose at most ${MAX_RESOURCES} files`);
      if (question.resourceSelector === 'destination_workspace' && (resources.length !== 1 || resources[0].kind !== 'workspace')) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This question asks for one workspace');
      }
      pick = { resources: await this.resolve(userId, resources) };
    }
    const picks = { ...resourcePicksOf(request.assessment) };
    if (pick) picks[questionId] = pick; else delete picks[questionId];
    const saved = await this.requests.saveResourcePicks(continuationId, userId, picks);
    if (!saved) throw new ConflictException(ErrorCode.CONFLICT, 'The assistant already continued without this choice');
    return this.getSources(userId, continuationId);
  }

  searchFiles(userId: string, search: string, page = 1) {
    return searchAccessibleFiles({ workspaces: this.workspaces, workspaceShares: this.workspaceShares, documents: this.documents }, userId, search, page);
  }

  private async waiting(continuationId: string, userId: string): Promise<PlaybookAssistantRequestRecord> {
    const request = await this.requests.findAwaitingContinuation(continuationId, userId);
    if (!request) throw new NotFoundException(ErrorCode.NOT_FOUND, 'These questions were already answered or have expired');
    return request;
  }

  private sourceQuestions(request: PlaybookAssistantRequestRecord) {
    const questions = Array.isArray(request.assessment?.questions) ? request.assessment.questions as ClarificationQuestionLike[] : [];
    return questions.filter(isSourceQuestion);
  }

  private async playbookName(request: PlaybookAssistantRequestRecord, userId: string): Promise<string | null> {
    if (request.playbookId) {
      const flow = await this.flows.findOneBase(request.playbookId, userId).catch(() => null);
      if (flow?.name) return flow.name;
    }
    return request.requestedName ?? null;
  }

  private describe(pick: ResourcePick | undefined) {
    if (!pick) return null;
    if ('skipped' in pick) return { skipped: true as const };
    if ('choice' in pick) return { skipped: false as const, option: pick.choice, resources: [] };
    return {
      skipped: false as const,
      resources: pick.resources.map((resource) => ({ kind: resource.kind, name: resource.label, workspaceName: resource.workspaceName })),
    };
  }

  /** Checks the person can open each workspace and file, and keeps them with their names. */
  private async resolve(userId: string, resources: { kind: 'workspace' | 'document'; id: string }[]): Promise<PickedResource[]> {
    if (resources.some((resource) => !isObjectId(resource.id))) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'A chosen source is invalid');
    const workspaceIds = resources.filter((resource) => resource.kind === 'workspace').map((resource) => resource.id);
    const documentIds = resources.filter((resource) => resource.kind === 'document').map((resource) => resource.id);
    const documents = documentIds.length ? await this.documents.findByIds(documentIds) : [];
    const files = documentIds.map((id) => documents.find((document) => document.id === id && !document.isFolder));
    if (files.some((file) => !file)) throw new ConflictException(ErrorCode.CONFLICT, 'A chosen file is no longer available');
    const allWorkspaceIds = [...new Set([...workspaceIds, ...files.map((file) => file!.workspaceId)])];
    await this.workspaceShares.assertUserHasAccess(userId, allWorkspaceIds);
    const names = new Map(await Promise.all(allWorkspaceIds.map(async (id) => [id, (await this.workspaces.findById(id)).name] as const)));
    const seen = new Set<string>();
    return resources.filter((resource) => !seen.has(resource.id) && Boolean(seen.add(resource.id))).map((resource) => {
      if (resource.kind === 'workspace') {
        const name = names.get(resource.id) ?? '';
        return { kind: 'workspace', id: resource.id, workspaceId: resource.id, workspaceName: name, label: name };
      }
      const file = files.find((candidate) => candidate!.id === resource.id)!;
      return {
        kind: 'document',
        id: file.id,
        workspaceId: file.workspaceId,
        workspaceName: names.get(file.workspaceId) ?? '',
        label: file.originalName,
        ...(file.path ? { path: file.path } : {}),
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      };
    });
  }
}
