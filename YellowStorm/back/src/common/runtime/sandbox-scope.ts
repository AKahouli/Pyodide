/**
 * Canonical runtime scope identity forwarded to the Code Interpreter (MCP Manus)
 * connector as x-sandbox-* headers. YellowStorm originates these values; MCP Manus
 * forwards them to the Runtime Coordinator, which enforces (scopeId, laneId) ownership.
 * See docs/superpowers/specs/2026-08-20-runtime-scope-context-propagation-design.md.
 */
export const CODE_INTERPRETER_CONNECTOR_SLUG = 'code-interpreter';

/**
 * Bindings that carry the canonical runtime scope headers: the Code Interpreter
 * (MCP Manus → Runtime Coordinator) and the Pyodide connectors — the merged
 * MCP Pyodide server serves the Manus sandbox tools (shell_exec, file_*,
 * send_file_to_user), which enforce the same (scopeId, laneId) ownership.
 */
function carriesRuntimeScope(slug: string | undefined): boolean {
  return slug === CODE_INTERPRETER_CONNECTOR_SLUG || (slug?.startsWith('pyodide') ?? false);
}

export interface SandboxRuntimeContext {
  userId: string;
  scopeType: 'conversation' | 'playbook';
  /** Already prefixed, e.g. "conversation:<sessionId>" or "playbook:<executionId>". */
  scopeId: string;
  /** "main" today; parallel-lane derivation is runtime-owned. */
  laneId: string;
  nodeId?: string;
  iteration?: number;
}

/** Pure: the x-sandbox-* header map for a given context. */
export function buildSandboxScopeHeaders(ctx: SandboxRuntimeContext): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-id': ctx.userId,
    'x-sandbox-scope-type': ctx.scopeType,
    'x-sandbox-scope-id': ctx.scopeId,
    'x-sandbox-lane-id': ctx.laneId,
  };
  if (ctx.nodeId !== undefined) headers['x-node-id'] = ctx.nodeId;
  if (ctx.iteration !== undefined) headers['x-node-iteration'] = String(ctx.iteration);
  return headers;
}

/**
 * Merge scope headers into the auth_headers of every binding whose slug is the
 * code-interpreter connector. Mutates and returns `bindings`; non-matching bindings
 * are untouched. Existing headers are preserved except that scope keys win on collision.
 */
export function applySandboxScopeHeaders<T extends { auth_headers?: Record<string, string> }>(
  bindings: T[],
  ctx: SandboxRuntimeContext,
  slugOf: (binding: T) => string | undefined,
): T[] {
  const scopeHeaders = buildSandboxScopeHeaders(ctx);
  for (const binding of bindings) {
    if (!carriesRuntimeScope(slugOf(binding))) continue;
    binding.auth_headers = { ...(binding.auth_headers || {}), ...scopeHeaders };
  }
  return bindings;
}
