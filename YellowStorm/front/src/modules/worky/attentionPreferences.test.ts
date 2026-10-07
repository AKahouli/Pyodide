import { beforeEach, describe, expect, it } from 'vitest';
import { readAttentionPreferences, saveAttentionPreferences } from './attentionPreferences';

beforeEach(() => localStorage.clear());

describe('attention preferences', () => {
  it('defaults to current sound and focus behavior and persists user changes', () => {
    expect(readAttentionPreferences()).toEqual({ sound: true, focus: true });
    saveAttentionPreferences({ sound: false, focus: false });
    expect(readAttentionPreferences()).toEqual({ sound: false, focus: false });
  });
});
