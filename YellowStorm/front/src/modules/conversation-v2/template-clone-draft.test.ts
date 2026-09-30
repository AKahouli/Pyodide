import { describe, expect, it } from 'vitest';
import {
  CLONE_ACTION_QUERY,
  conversationV2CloneDraftPath,
  isCloneDraftSearch,
} from './template-clone-draft';

describe('template-clone-draft', () => {
  it('builds a real session path with ?action=clone (no template id in the URL)', () => {
    expect(conversationV2CloneDraftPath('33209d21af8ec4c6c8af7f37')).toBe(
      '/conversation-v2/33209d21af8ec4c6c8af7f37?action=clone',
    );
  });

  it('detects the draft query flag', () => {
    expect(CLONE_ACTION_QUERY).toBe('clone');
    expect(isCloneDraftSearch(new URLSearchParams('action=clone'))).toBe(true);
    expect(isCloneDraftSearch(new URLSearchParams(''))).toBe(false);
    expect(isCloneDraftSearch(new URLSearchParams('action=other'))).toBe(false);
  });
});
