import { afterEach, describe, expect, it } from 'vitest';
import type { Agent } from '../../types';
import type { Team } from '@/modules/team/types';
import { matchesLibrarySearch, readLibraryPreferences } from './library-model';

describe('library discovery', () => {
  afterEach(() => localStorage.clear());
  const agent = { id: 'a', name: 'Analyste', description: 'Étude financière', role: 'Budget' } as Agent;
  it('finds expertise across accents and multiple words', () => {
    expect(matchesLibrarySearch({ kind: 'agent', value: agent }, 'FINANCIERE budget')).toBe(true);
    expect(matchesLibrarySearch({ kind: 'agent', value: agent }, 'budget juridique')).toBe(false);
  });
  it('finds a team through its member expertise', () => {
    const team = { name: 'Finance', members: [{ agentId: 'a' }] } as Team;
    expect(matchesLibrarySearch({ kind: 'team', value: team }, 'etude', [agent])).toBe(true);
  });
  it('recovers from malformed preferences and ignores invalid entries', () => {
    localStorage.setItem('prefs', '{');
    expect(readLibraryPreferences('prefs')).toEqual({ saved: [], recent: [] });
    localStorage.setItem('prefs', JSON.stringify({ saved: [4, 'agent:a', null], recent: [] }));
    expect(readLibraryPreferences('prefs').saved).toEqual(['agent:a']);
  });
});
