import type { MessageComponent } from './message.interface';

export type DisplayedConversationAnswerVersion = 'original' | 'corrected' | 'abstention' | `attempt:${string}`;

export interface SafeExecutionSummary {
  summary: string;
  status: string;
  actorLabel?: string;
}

export interface SafePlanStep {
  label: string;
  status?: string;
}

export interface SafeActionIdentity {
  name: string;
  label?: string;
  kind?: string;
  status?: string;
  summary?: string;
}

export interface SafeResourceReference {
  kind: 'workspace' | 'document' | 'connector' | 'agent' | 'skill' | 'citation' | 'artifact';
  id?: string;
  label: string;
}

export interface TrustedConversationPlaybookContextV1 {
  contextVersion: 1;
  userGoal?: string;
  answerOutline?: string;
  outputFormatSummary?: string;
  executionSummaries: SafeExecutionSummary[];
  planSteps: SafePlanStep[];
  actions: SafeActionIdentity[];
  agents: SafeResourceReference[];
  skills: SafeResourceReference[];
  references: SafeResourceReference[];
  projection: {
    generatedAt: string;
    sourceMessageCount: number;
    includedMessageCount: number;
    omissions: Record<string, number>;
  };
}

export interface ConversationPlaybookPreviewV1 {
  goal?: string;
  answerOutline?: string;
  executionSummaries: SafeExecutionSummary[];
  planSteps: SafePlanStep[];
  actions: SafeActionIdentity[];
  resources: SafeResourceReference[];
  omissions: Record<string, number>;
}

export interface ResolvedConversationPlaybookHandoffV1 {
  handoffId: string;
  handoffVersion: 1;
  sourceConversationId: string;
  targetMessageId: string;
  displayedAnswerVersion: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;
  context: TrustedConversationPlaybookContextV1;
  workspaceDefaultIds: string[];
  acceptedAt: string;
}

export interface ResolvedDisplayedAnswer {
  version: DisplayedConversationAnswerVersion;
  components: MessageComponent[];
}
