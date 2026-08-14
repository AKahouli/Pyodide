import type { PlaybookNodeType } from '../types';

export interface PlaybookNodeCapabilities {
  requiresAgent: boolean;
  supportsModel: boolean;
  supportsDynamicReasoning: boolean;
  supportsDeepSearch: boolean;
  supportsExpectedResult: boolean;
  supportsReference: boolean;
  supportsReplayReasoning: boolean;
  supportsAdvisorEvaluation: boolean;
  supportsRetry: boolean;
  supportsSmartHitl: boolean;
  supportsClarification: boolean;
}

const CAPABILITIES: Record<PlaybookNodeType, PlaybookNodeCapabilities> = {
  agent: {
    requiresAgent: true,
    supportsModel: true,
    supportsDynamicReasoning: true,
    supportsDeepSearch: true,
    supportsExpectedResult: true,
    supportsReference: true,
    supportsReplayReasoning: true,
    supportsAdvisorEvaluation: true,
    supportsRetry: true,
    supportsSmartHitl: true,
    supportsClarification: true,
  },
  action: {
    requiresAgent: false,
    supportsModel: false,
    supportsDynamicReasoning: false,
    supportsDeepSearch: false,
    supportsExpectedResult: true,
    supportsReference: true,
    supportsReplayReasoning: false,
    supportsAdvisorEvaluation: false,
    supportsRetry: false,
    supportsSmartHitl: false,
    supportsClarification: false,
  },
  iterator: {
    requiresAgent: false,
    supportsModel: false,
    supportsDynamicReasoning: false,
    supportsDeepSearch: false,
    supportsExpectedResult: true,
    supportsReference: false,
    supportsReplayReasoning: false,
    supportsAdvisorEvaluation: false,
    supportsRetry: false,
    supportsSmartHitl: false,
    supportsClarification: false,
  },
  evaluation: {
    requiresAgent: true,
    supportsModel: true,
    supportsDynamicReasoning: true,
    supportsDeepSearch: true,
    supportsExpectedResult: false,
    supportsReference: true,
    supportsReplayReasoning: true,
    supportsAdvisorEvaluation: true,
    supportsRetry: true,
    supportsSmartHitl: true,
    supportsClarification: true,
  },
  router: {
    requiresAgent: false,
    supportsModel: false,
    supportsDynamicReasoning: false,
    supportsDeepSearch: false,
    supportsExpectedResult: false,
    supportsReference: false,
    supportsReplayReasoning: false,
    supportsAdvisorEvaluation: false,
    supportsRetry: false,
    supportsSmartHitl: false,
    supportsClarification: false,
  },
  human_approval: {
    requiresAgent: false,
    supportsModel: false,
    supportsDynamicReasoning: false,
    supportsDeepSearch: false,
    supportsExpectedResult: false,
    supportsReference: false,
    supportsReplayReasoning: false,
    supportsAdvisorEvaluation: false,
    supportsRetry: false,
    supportsSmartHitl: false,
    supportsClarification: false,
  },
};

export function getNodeCapabilities(nodeType: PlaybookNodeType): PlaybookNodeCapabilities {
  return CAPABILITIES[nodeType];
}
