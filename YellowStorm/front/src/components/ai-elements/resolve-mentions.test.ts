import { describe, expect, it } from 'vitest';
import { resolveMentions } from './resolve-mentions';

describe('conversation mention identities', () => {
  const agents = [{ id: 'agent', name: 'Sales', isActive: true }];
  it('keeps the explicitly selected team when names collide, including a retry', () => {
    const tracked = new Map([['Sales', { id: 'team', type: 'team' as const }]]);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(resolveMentions('@Sales Help me plan', tracked, agents, [{ id: 'team', name: 'Sales' }]))
        .toEqual({ agentIds: [], memberIds: [], teamIds: ['team'] });
    }
  });
  it('resolves an edited longer team name instead of its tracked prefix', () => {
    expect(resolveMentions('@Sales Team Help', new Map([['Sales', { id: 'agent', type: 'agent' }]]), agents, [{ id: 'team', name: 'Sales Team' }]))
      .toEqual({ agentIds: [], memberIds: [], teamIds: ['team'] });
  });
  it('ignores removed mentions, email addresses, and name prefixes', () => {
    expect(resolveMentions('a@Sales @Salesforce', new Map(), agents, []).agentIds).toEqual([]);
  });
  it('supports punctuation in names and separate repeated mentions', () => {
    expect(resolveMentions('@M&A (EU), review. @Sales: help @Sales', new Map(), agents, [{ id: 'team', name: 'M&A (EU)' }]))
      .toEqual({ agentIds: ['agent'], memberIds: [], teamIds: ['team'] });
  });
});
