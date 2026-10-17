import type { ActionEvent } from '@openuidev/react-lang';
import { createContext } from 'react';
import type { ArtifactActivityData, OpenUiSubmission } from '../../types';

export const OpenUiSubmissionContext = createContext<Record<string, 'submitting' | 'submitted' | 'error'>>({});
export const MiniAppAutosaveContext = createContext(false);
export const submissionKey = (submission: Pick<OpenUiSubmission, 'formName' | 'label'>): string => submission.formName ?? submission.label ?? '';
export function submissionSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(submissionSignature).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${submissionSignature(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Reject non-JSON values rather than coercing them and changing their meaning. */
export function typedActionData(value: unknown): Record<string, import('../../types').OpenUiJson> {
  let entries = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || ++entries > 200) throw new Error('Invalid action data');
    if (node === null || typeof node === 'string' || typeof node === 'boolean' || (typeof node === 'number' && Number.isFinite(node))) return;
    if (Array.isArray(node)) { node.forEach(child => visit(child, depth + 1)); return; }
    if (!isRecord(node) || Object.getPrototypeOf(node) !== Object.prototype) throw new Error('Invalid action data');
    for (const [key, child] of Object.entries(node)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid action data');
      visit(child, depth + 1);
    }
  };
  if (!isRecord(value)) throw new Error('Invalid action data');
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > 20_000) throw new Error('Invalid action data');
  return JSON.parse(encoded) as Record<string, import('../../types').OpenUiJson>;
}

export type FollowUp =
  | { kind: 'message'; content: string; submission?: Pick<OpenUiSubmission, 'formName' | 'label' | 'formState' | 'params'> }
  | { kind: 'open-url'; url: string }
  | { kind: 'download-artifact'; artifact: ArtifactActivityData }
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
export function toFollowUpMessage(event: ActionEvent, artifacts: readonly ArtifactActivityData[] = []): FollowUp {
  if (event.type === 'AskAgent') {
    const instruction = event.params?.instruction;
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2000) throw new Error('Invalid app instruction');
    const inputs = typedActionData(event.params?.inputs);
    const label = event.humanFriendlyMessage?.trim() || instruction.trim();
    // Same authorized conversation turn and typed persistence contract as ordinary forms.
    // Including JSON in the readable turn lets the existing agent act on the exact inputs.
    const formState = typedActionData(event.formState ?? {});
    return { kind: 'message', content: `${label}\n\n${instruction.trim()}\n\nInputs (JSON):\n${JSON.stringify(inputs)}`,
      submission: { ...(event.formName ? { formName: event.formName } : {}), label, formState,
        params: typedActionData({ instruction: instruction.trim(), inputs }) } };
  }
  // Resolve only artifacts persisted on this answer. A model-provided path/URL is never fetched.
  if (['download_artifact', 'download_file', 'download', OPEN_URL].includes(event.type)) {
    const reference = event.params?.artifactId ?? event.params?.filename ?? event.params?.fileName ?? event.params?.path ?? event.params?.url;
    if (typeof reference === 'string') {
      const filename = reference.startsWith('artifacts/main/') || reference.startsWith('/mnt/yellowmind/run/outputs/') || reference.startsWith('sandbox:/mnt/')
        ? reference.split('/').at(-1) : reference;
      const matches = artifacts.filter((artifact) => artifact.availability === 'ready'
        && (artifact.artifactId === reference || artifact.filename === filename));
      if (matches.length === 1) return { kind: 'download-artifact', artifact: matches[0] };
    }
    if (event.type !== OPEN_URL) return { kind: 'ignore' };
  }
  if (event.type === CONTINUE_CONVERSATION) {
    const label = event.humanFriendlyMessage?.trim();
    const hasForm = event.formState && Object.keys(event.formState).length > 0;
    const hasParams = Object.keys(event.params ?? {}).length > 0;
    if (!label && !hasForm && !hasParams) return { kind: 'ignore' };
    const formState = typedActionData(event.formState ?? {});
    const params = typedActionData(event.params ?? {});
    const values = hasForm ? formatFormValues(formState).join('\n') : '';
    const content = values ? `${label ?? ''}\n\n${values}`.trim() : label;
    if (hasForm || hasParams) return { kind: 'message', content: content || JSON.stringify(event.formState ?? event.params),
      submission: { ...(event.formName ? { formName: event.formName } : {}), ...(label ? { label } : {}),
        formState, params } };
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
