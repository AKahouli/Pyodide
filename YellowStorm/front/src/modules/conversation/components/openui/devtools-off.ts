/**
 * `@openuidev/react-lang` auto-mounts a development-only inspector when it is
 * first evaluated; the inspector bundle comes from cdn.jsdelivr.net, which our
 * CSP blocks (it only produced a console error). The mount is guarded by this
 * once-only global flag, so setting it first skips the mount entirely.
 *
 * Import this module BEFORE anything that imports `@openuidev/react-lang`.
 * It is a no-op in production builds, where the auto-mount is compiled out.
 */
export const OPENUI_DEVTOOLS_AUTOMOUNT_FLAG = Symbol.for('openui.devtools.autoMount');

(globalThis as Record<symbol, unknown>)[OPENUI_DEVTOOLS_AUTOMOUNT_FLAG] = true;
