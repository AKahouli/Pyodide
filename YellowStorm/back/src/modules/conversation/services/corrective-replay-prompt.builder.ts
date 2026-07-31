import { Injectable } from '@nestjs/common';
import type {
  CorrectionReplayContext,
  CorrectionReplayFinding,
  ReliabilityEvaluation,
} from '../interfaces/message.interface';

export const CORRECTIVE_REPLAY_PROMPT_VERSION = 'corrective-replay-v2';
export const MAX_REPLAY_ORIGINAL_ANSWER_CHARACTERS = 30_000;
export const MAX_REPLAY_FINDINGS = 20;
export const MAX_REPLAY_FINDING_CHARACTERS = 2_000;

const INSTRUCTIONS = `Re-answer the original user request from scratch.

This is a corrective replay of a previous answer.

Use the previous answer only as diagnostic context. Preserve useful and correct content, but do not repeat unsupported, partially supported, or contradicted claims.

Pay particular attention to the evaluator findings. Use the normal agent workflow, retrieval process, tools, skills, and connected resources to produce a better-supported answer.

Do not invent facts, evidence, calculations, or citations.

Produce a complete answer to the original user request.

Do not mention the internal reliability evaluation, correction process, previous score, or corrective instructions in the user-facing answer.`;

export interface CorrectiveReplayPromptInput {
  originalQuestion: string;
  originalAnswer: string;
  evaluation: ReliabilityEvaluation;
  attemptNumber: number;
}

export interface CorrectiveReplayPrompt {
  userQuery: string;
  correctionContext: CorrectionReplayContext;
}

@Injectable()
export class CorrectiveReplayPromptBuilder {
  build(input: CorrectiveReplayPromptInput): CorrectiveReplayPrompt {
    const findings: CorrectionReplayFinding[] = (input.evaluation.findings ?? input.evaluation.claims ?? [])
      .filter((finding): finding is typeof finding & CorrectionReplayFinding =>
        finding.status !== 'supported')
      .slice(0, MAX_REPLAY_FINDINGS)
      .map((finding) => ({
        claim: finding.claim.slice(0, MAX_REPLAY_FINDING_CHARACTERS),
        status: finding.status,
        importance: finding.importance,
        explanation: finding.explanation.slice(0, MAX_REPLAY_FINDING_CHARACTERS),
      }));

    return {
      userQuery: input.originalQuestion,
      correctionContext: {
        originalAnswer: input.originalAnswer.slice(0, MAX_REPLAY_ORIGINAL_ANSWER_CHARACTERS),
        findings,
        attemptNumber: input.attemptNumber,
        instructions: INSTRUCTIONS,
      },
    };
  }
}
