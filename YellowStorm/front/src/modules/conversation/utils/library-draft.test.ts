import { describe, expect, it } from 'vitest';
import { readLibraryDraft } from './library-draft';
describe('library draft handoff', () => {
  it('preserves an explicitly selected team and editable starter', () => {
    const draft = { id: 't', name: 'Finance', kind: 'team', text: 'Help me plan', key: 'draft-1' };
    expect(readLibraryDraft({ libraryDraft: draft })).toEqual(draft);
  });
  it('rejects incomplete or unrelated route state', () => {
    for (const state of [null, {}, { libraryDraft: { kind: 'team', name: 'Finance' } }, { libraryDraft: 'team' }]) {
      expect(readLibraryDraft(state)).toBeUndefined();
    }
  });
});
