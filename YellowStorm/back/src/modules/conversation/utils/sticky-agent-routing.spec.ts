import { resolveStickyAgentRouting } from './sticky-agent-routing';

describe('resolveStickyAgentRouting', () => {
  it('replaces with mentions when present', () => {
    expect(
      resolveStickyAgentRouting({
        mentionedAgentIds: ['1', '2'],
        stickyAgentIds: ['3'],
        reuseSticky: true,
      }),
    ).toEqual({
      effectiveAgentIds: ['1', '2'],
      agentSource: 'mention',
      shouldReplaceSticky: true,
    });
  });

  it('reuses sticky when no mentions and reuseSticky is true', () => {
    expect(
      resolveStickyAgentRouting({
        mentionedAgentIds: [],
        stickyAgentIds: ['3'],
        reuseSticky: true,
      }),
    ).toEqual({
      effectiveAgentIds: ['3'],
      agentSource: 'sticky',
      shouldReplaceSticky: false,
    });
  });

  it('falls back to none when sticky empty', () => {
    expect(
      resolveStickyAgentRouting({
        mentionedAgentIds: [],
        stickyAgentIds: [],
        reuseSticky: true,
      }),
    ).toEqual({
      effectiveAgentIds: undefined,
      agentSource: 'none',
      shouldReplaceSticky: false,
    });
  });

  it('does not reuse sticky on member-only turns', () => {
    expect(
      resolveStickyAgentRouting({
        mentionedAgentIds: [],
        stickyAgentIds: ['3'],
        reuseSticky: false,
      }),
    ).toEqual({
      effectiveAgentIds: undefined,
      agentSource: 'none',
      shouldReplaceSticky: false,
    });
  });

  it('still applies mentions when reuseSticky is false', () => {
    expect(
      resolveStickyAgentRouting({
        mentionedAgentIds: ['1'],
        stickyAgentIds: ['3'],
        reuseSticky: false,
      }),
    ).toEqual({
      effectiveAgentIds: ['1'],
      agentSource: 'mention',
      shouldReplaceSticky: true,
    });
  });
});
