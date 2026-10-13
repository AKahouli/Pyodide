import type { ActionEvent } from '@openuidev/react-lang';

export type FollowUp =
  | { kind: 'message'; content: string }
  | { kind: 'open-url'; url: string }
  | { kind: 'ignore' };

const CONTINUE_CONVERSATION = 'continue_conversation';
const OPEN_URL = 'open_url';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Submitted form values as readable `name: value` lines. OpenUI keeps each field as
 * `{ value, componentType }`, optionally grouped under its form name; the field name is the
 * only label the state carries, so it stands in for one. Empty fields are left out.
 */
export function formatFormValues(state: Record<string, unknown>): string[] {
  return Object.entries(state).flatMap(([name, entry]): string[] => {
    if (isRecord(entry) && 'value' in entry && 'componentType' in entry) {
      const value = formatValue(entry.value);
      return entry.value == null || value === '' ? [] : [`${name}: ${value}`];
    }
    if (isRecord(entry)) return formatFormValues(entry);
    return entry == null || entry === '' ? [] : [`${name}: ${formatValue(entry)}`];
  });
}

/**
 * Maps an OpenUI action to what the conversation does with it: a follow-up
 * user message (button label plus submitted form values) or an external link.
 * Unknown action types are ignored rather than guessed at.
 */
export function toFollowUpMessage(event: ActionEvent): FollowUp {
  if (event.type === CONTINUE_CONVERSATION) {
    const label = event.humanFriendlyMessage?.trim();
    const hasForm = event.formState && Object.keys(event.formState).length > 0;
    if (!label && !hasForm) return { kind: 'ignore' };
    const values = hasForm ? formatFormValues(event.formState!).join('\n') : '';
    const content = values ? `${label ?? ''}\n\n${values}`.trim() : label;
    if (!content) return { kind: 'ignore' };
    return { kind: 'message', content };
  }
  if (event.type === OPEN_URL) {
    const raw = event.params?.url;
    if (typeof raw !== 'string') return { kind: 'ignore' };
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' || url.protocol === 'http:' ? { kind: 'open-url', url: url.href } : { kind: 'ignore' };
    } catch {
      return { kind: 'ignore' };
    }
  }
  return { kind: 'ignore' };
}
