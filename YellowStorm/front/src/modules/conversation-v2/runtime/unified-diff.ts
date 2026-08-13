import { applyPatch, createTwoFilesPatch, parsePatch } from 'diff';
import { ToolError } from './ToolError';
import { RuntimeErrorCodes } from './runtime.types';

/**
 * Apply a unified diff to a single file. jsdiff handles hunk offsets and
 * context fuzz, which a hand-rolled applier gets wrong on any patch whose line
 * numbers have drifted.
 *
 * @throws ToolError `-32602` when the patch does not apply cleanly
 */
export function applyUnifiedPatch(
  source: string,
  patch: string,
  path: string,
): string {
  let patched: string | false;
  try {
    // jsdiff treats a hunk-less patch as a successful no-op, which would let a
    // malformed patch report success without changing anything.
    const parsed = parsePatch(patch);
    if (parsed.length === 0 || parsed.every((file) => file.hunks.length === 0)) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        'Patch contains no hunks',
        { path },
      );
    }
    patched = applyPatch(source, patch);
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError(
      RuntimeErrorCodes.INVALID_PARAMS,
      `Patch could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      { path },
    );
  }

  if (patched === false) {
    throw new ToolError(
      RuntimeErrorCodes.INVALID_PARAMS,
      'Patch could not be applied',
      { path },
    );
  }

  return patched;
}

/** Unified diff between two versions of one file, for `apply_patch.diff`. */
export function createUnifiedDiff(
  path: string,
  before: string,
  after: string,
): string {
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, '', '');
}
