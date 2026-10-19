import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The back end appends a committed copy of the OpenUI output-format prompt to the agents with generative UI on.
 * It is generated from the library we render here, so a library or rule change must regenerate it.
 */
describe('OpenUI output-format prompt (committed back-end module)', () => {
  it('is up to date with the generator', () => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/generate-openui-prompt.mjs'), '--check'], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/^(?:Warning: the OpenUI prompt is \d+ characters, over the \d+ target\.\r?\n)?$/);
  }, 60_000);
});
