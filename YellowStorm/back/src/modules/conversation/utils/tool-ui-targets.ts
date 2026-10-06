/**
 * Buttons a tool result asks the conversation to show ("Open Billing & Contract Management"). A tool
 * result is not sent with saved messages (it can be large), so the few `uiTarget` objects it carries are
 * kept next to it: the buttons still show after the conversation is reopened.
 */

export interface ToolUiTarget {
  surface: string;
  params: Record<string, string>;
  effects?: unknown[];
}

const MAX_RESULT_LENGTH = 262_144;
const MAX_TARGETS = 5;
const MAX_DEPTH = 6;

function asTarget(value: unknown): ToolUiTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { surface, params, effects } = value as Record<string, unknown>;
  if (typeof surface !== 'string' || !/^[a-zA-Z][\w.]{0,80}$/.test(surface)) return null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const entries = Object.entries(params as Record<string, unknown>);
  if (entries.length > 10 || entries.some(([key, item]) => typeof item !== 'string' || key.length > 60 || item.length > 300)) return null;
  return {
    surface,
    params: Object.fromEntries(entries) as Record<string, string>,
    ...(Array.isArray(effects) && effects.length <= 5 ? { effects } : {}),
  };
}

/** The `uiTarget` objects found in a tool result, deduplicated, at most five. */
export function extractToolUiTargets(resultJson: unknown): ToolUiTarget[] {
  if (typeof resultJson !== 'string' || !resultJson || resultJson.length > MAX_RESULT_LENGTH) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return [];
  }
  const found = new Map<string, ToolUiTarget>();
  const visit = (value: unknown, depth: number) => {
    if (found.size >= MAX_TARGETS || depth > MAX_DEPTH || !value || typeof value !== 'object') return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) {
      value.forEach((item) => { visit(item, depth + 1); });
      return;
    }
    const record = value as Record<string, unknown>;
    const target = asTarget(record.uiTarget);
    if (target) found.set(JSON.stringify([target.surface, target.params, target.effects ?? []]), target);
    for (const [key, item] of Object.entries(record)) {
      if (key === 'uiTarget') continue;
      if (typeof item === 'string' && item.startsWith('{') && item.length <= MAX_RESULT_LENGTH) {
        // MCP results often carry the structured payload as JSON text.
        try { visit(JSON.parse(item), depth + 1); } catch { /* not JSON */ }
      } else {
        visit(item, depth + 1);
      }
    }
  };
  visit(parsed, 0);
  return [...found.values()];
}
