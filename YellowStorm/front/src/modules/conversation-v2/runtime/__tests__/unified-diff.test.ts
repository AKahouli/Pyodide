import { describe, it, expect } from 'vitest';
import { createTwoFilesPatch } from 'diff';
import { applyUnifiedPatch, createUnifiedDiff } from '../unified-diff';
import { ToolError } from '../ToolError';
import { RuntimeErrorCodes } from '../runtime.types';

const BEFORE = ['import React from "react";', '', 'export const answer = 41;', ''].join('\n');
const AFTER = ['import React from "react";', '', 'export const answer = 42;', ''].join('\n');

function patchFor(before: string, after: string): string {
  return createTwoFilesPatch('a/src/App.tsx', 'b/src/App.tsx', before, after, '', '');
}

describe('applyUnifiedPatch', () => {
  it('applies a well-formed unified diff', () => {
    expect(applyUnifiedPatch(BEFORE, patchFor(BEFORE, AFTER), 'src/App.tsx')).toBe(AFTER);
  });

  it('applies a patch whose hunk offsets have drifted', () => {
    const patch = patchFor(BEFORE, AFTER);
    // Prepending lines shifts every hunk; jsdiff re-anchors on context.
    const drifted = `// added header\n// another line\n${BEFORE}`;
    expect(applyUnifiedPatch(drifted, patch, 'src/App.tsx')).toContain('answer = 42');
  });

  it('throws INVALID_PARAMS when the context does not match', () => {
    const patch = patchFor(BEFORE, AFTER);
    try {
      applyUnifiedPatch('completely different content\n', patch, 'src/App.tsx');
      throw new Error('expected a ToolError');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe(RuntimeErrorCodes.INVALID_PARAMS);
      expect((err as ToolError).data).toMatchObject({ path: 'src/App.tsx' });
    }
  });

  it('throws INVALID_PARAMS on a patch with no hunks', () => {
    expect(() => applyUnifiedPatch(BEFORE, 'not a patch at all', 'src/App.tsx')).toThrow(
      ToolError,
    );
  });
});

describe('createUnifiedDiff', () => {
  it('produces a diff that round-trips through applyUnifiedPatch', () => {
    const diff = createUnifiedDiff('src/App.tsx', BEFORE, AFTER);
    expect(diff).toContain('--- a/src/App.tsx');
    expect(diff).toContain('+++ b/src/App.tsx');
    expect(applyUnifiedPatch(BEFORE, diff, 'src/App.tsx')).toBe(AFTER);
  });
});
