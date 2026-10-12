import { describe, expect, it } from 'vitest';
import { OPENUI_DEVTOOLS_AUTOMOUNT_FLAG } from './devtools-off';

describe('OpenUI devtools auto-mount', () => {
  it('is switched off through react-lang\'s once-only guard flag, with no CSP change', () => {
    expect(OPENUI_DEVTOOLS_AUTOMOUNT_FLAG).toBe(Symbol.for('openui.devtools.autoMount'));
    expect((globalThis as Record<symbol, unknown>)[OPENUI_DEVTOOLS_AUTOMOUNT_FLAG]).toBe(true);
  });
});
