/**
 * Workspaces and files the person chose themselves, in the conversation card or the designer, for the
 * clarification questions that ask for a source or a destination. They are kept next to the waiting
 * assessment (`resourcePicks`) and joined to the assistant's answers when it continues the clarification,
 * so the assistant never has to search workspaces or handle their ids.
 */

export type ResourceSelector = 'workspace_or_document' | 'destination_workspace';

export interface PickedResource {
  kind: 'workspace' | 'document';
  id: string;
  workspaceId: string;
  workspaceName: string;
  label: string;
  path?: string;
  mimeType?: string;
}

/** Workspaces and files, one of the question's own choices ("SharePoint", "Pasted at launch"), or skipped. */
export type ResourcePick = { resources: PickedResource[] } | { choice: string } | { skipped: true };

export interface ClarificationQuestionLike {
  id?: string;
  question?: string;
  reason?: string;
  required?: boolean;
  choices?: string[];
  resourceSelector?: ResourceSelector;
}

export interface ClarificationAnswerLike {
  questionId: string;
  choice?: string;
  text?: string;
  resource?: { kind: 'workspace' | 'document'; id: string; workspaceId?: string; workspaceName?: string; label?: string; path?: string; mimeType?: string };
  resources?: PickedResource[];
}

/** What a skipped source question tells the construction: the playbook asks for it when it runs. */
export const SKIPPED_SOURCE_ANSWER = 'The person skipped this choice: ask for it as a run-time input when the playbook runs.';

export function resourcePicksOf(assessment: Record<string, unknown> | null | undefined): Record<string, ResourcePick> {
  const picks = assessment?.resourcePicks;
  return picks && typeof picks === 'object' && !Array.isArray(picks) ? picks as Record<string, ResourcePick> : {};
}

export function isSourceQuestion(question: ClarificationQuestionLike): question is ClarificationQuestionLike & { id: string; resourceSelector: ResourceSelector } {
  return Boolean(question.id && (question.resourceSelector === 'workspace_or_document' || question.resourceSelector === 'destination_workspace'));
}

/** The assistant's answers, with the person's own choices in place of whatever it said for those questions. */
export function withResourcePicks<T extends ClarificationAnswerLike>(
  questions: ClarificationQuestionLike[],
  answers: T[],
  picks: Record<string, ResourcePick>,
): (T | ClarificationAnswerLike)[] {
  const picked = questions.filter(isSourceQuestion).filter((question) => picks[question.id]);
  if (!picked.length) return answers;
  const pickedIds = new Set(picked.map((question) => question.id));
  return [
    ...answers.filter((answer) => !pickedIds.has(answer.questionId)),
    ...picked.map((question) => {
      const pick = picks[question.id];
      if ('skipped' in pick) return { questionId: question.id, text: SKIPPED_SOURCE_ANSWER };
      if ('choice' in pick) return { questionId: question.id, choice: pick.choice };
      return { questionId: question.id, resources: pick.resources };
    }),
  ];
}

const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/\[/g, '(').replace(/]/g, ')').trim();

/**
 * One `question: label [kind=…, id=…]` line per chosen workspace or file: the construction reads these
 * lines as trusted resources and binds a chosen workspace as a fixed task input.
 */
export function resourceClarificationLines(questions: ClarificationQuestionLike[], answers: ClarificationAnswerLike[]): string[] {
  const questionText = new Map(questions.filter((question) => question.id).map((question) => [question.id!, question.question || question.id!]));
  return answers.flatMap((answer) => {
    const resources: (Partial<PickedResource> & { kind: 'workspace' | 'document'; id: string })[] = answer.resources ?? (answer.resource ? [answer.resource] : []);
    const question = clean(questionText.get(answer.questionId) ?? answer.questionId).replace(/:/g, ' -');
    return resources.map((resource) => {
      const workspaceId = resource.workspaceId || (resource.kind === 'workspace' ? resource.id : '');
      const label = clean(resource.label || resource.workspaceName || (resource.kind === 'workspace' ? 'Chosen workspace' : 'Chosen file'));
      const metadata = [
        `kind=${resource.kind}`,
        `id=${resource.id}`,
        ...(workspaceId ? [`workspaceId=${workspaceId}`] : []),
        ...(resource.workspaceName ? [`workspaceName=${clean(resource.workspaceName)}`] : []),
        ...(resource.path ? [`path=${clean(resource.path)}`] : []),
        ...(resource.mimeType ? [`mimeType=${resource.mimeType}`] : []),
      ];
      return `${question}: ${label} [${metadata.join(', ')}]`;
    });
  });
}

/** The workspaces the chosen sources sit in, for the new playbook's own workspace list. */
export function chosenWorkspaceIds(answers: ClarificationAnswerLike[]): string[] {
  return [...new Set(answers.flatMap((answer) => (answer.resources ?? (answer.resource ? [answer.resource] : []))
    .map((resource) => resource.workspaceId || (resource.kind === 'workspace' ? resource.id : ''))
    .filter(Boolean)))];
}

/** The assessment as the assistant sees it: the choices by name only, never their ids. */
export function publicAssessment<T extends Record<string, unknown>>(assessment: T): T {
  if (!('resourcePicks' in assessment)) return assessment;
  const { resourcePicks, ...rest } = assessment as T & { resourcePicks?: unknown };
  const picks = resourcePicksOf({ resourcePicks });
  const chosenSources = Object.entries(picks).map(([questionId, pick]) => {
    if ('skipped' in pick) return { questionId, skipped: true };
    if ('choice' in pick) return { questionId, chosen: [pick.choice] };
    return { questionId, chosen: pick.resources.map((resource) => resource.kind === 'workspace' ? `${resource.label} (workspace)` : `${resource.label} (${resource.workspaceName})`) };
  });
  return { ...rest, ...(chosenSources.length ? { chosenSources } : {}) } as unknown as T;
}

/** The card that lets the person choose the sources of a waiting clarification, when it asks for any. */
export function sourcesUiTarget(continuationId: unknown, questions: unknown, playbookName?: string | null) {
  if (typeof continuationId !== 'string' || !continuationId || !Array.isArray(questions)) return undefined;
  if (!(questions as ClarificationQuestionLike[]).some(isSourceQuestion)) return undefined;
  return {
    surface: 'playbook.sources' as const,
    params: { continuationId, ...(playbookName?.trim() ? { playbookName: playbookName.trim().slice(0, 300) } : {}) },
  };
}
