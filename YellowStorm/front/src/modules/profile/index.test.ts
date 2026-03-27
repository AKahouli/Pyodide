import { describe, expect, it } from 'vitest';
import * as profileModule from './index';

describe('profile module index', () => {
  it('exports settings hooks and modal', () => {
    expect(profileModule.SettingsModalProvider).toBeDefined();
    expect(profileModule.useSettingsModal).toBeDefined();
    expect(profileModule.SettingsModal).toBeDefined();
  });
});
