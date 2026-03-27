import { describe, expect, it } from 'vitest';
import * as components from './index';

describe('profile components index', () => {
  it('exports key components', () => {
    expect(components.SettingsModal).toBeDefined();
    expect(components.ProfileSection).toBeDefined();
    expect(components.SessionsSection).toBeDefined();
    expect(components.AppearanceSection).toBeDefined();
    expect(components.DataControlsSection).toBeDefined();
    expect(components.HealthSection).toBeDefined();
  });
});
