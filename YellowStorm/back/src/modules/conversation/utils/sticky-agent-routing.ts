export type StickyAgentSource = 'mention' | 'sticky' | 'none';

export interface StickyAgentRoutingInput {
  mentionedAgentIds: string[];
  stickyAgentIds: string[];
  /** When false (e.g. member-only turns), never reuse sticky agents. */
  reuseSticky: boolean;
}

export interface StickyAgentRoutingResult {
  effectiveAgentIds: string[] | undefined;
  agentSource: StickyAgentSource;
  shouldReplaceSticky: boolean;
}

/**
 * Resolves which agent IDs to use for a turn given mentions and conversation sticky state.
 * Mentions always win and signal a full sticky replace; sticky reuse is optional.
 */
export function resolveStickyAgentRouting(
  input: StickyAgentRoutingInput,
): StickyAgentRoutingResult {
  const { mentionedAgentIds, stickyAgentIds, reuseSticky } = input;

  if (mentionedAgentIds.length > 0) {
    return {
      effectiveAgentIds: mentionedAgentIds,
      agentSource: 'mention',
      shouldReplaceSticky: true,
    };
  }

  if (reuseSticky && stickyAgentIds.length > 0) {
    return {
      effectiveAgentIds: stickyAgentIds,
      agentSource: 'sticky',
      shouldReplaceSticky: false,
    };
  }

  return {
    effectiveAgentIds: undefined,
    agentSource: 'none',
    shouldReplaceSticky: false,
  };
}
