import type { NativeInputSchema, PendingRootInput } from '../types';

export function nativeInputKey(root: PendingRootInput, input: PendingRootInput['inputs'][number]) {
  return `${root.executionId}:${root.epoch}:${input.inputId}:${input.inputVersion ?? 1}`;
}

export function nativeInputLabel(schema: NativeInputSchema | undefined, key: string) {
  return schema?.title || key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Display text only; the native response envelope remains unchanged. */
export function nativeInputSummary(value: unknown, schema?: NativeInputSchema): string {
  if (Array.isArray(value)) return value.map((item) => nativeInputSummary(item, schema?.items)).join('; ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) =>
    `${nativeInputLabel(schema?.properties?.[key], key)}: ${nativeInputSummary(item, schema?.properties?.[key])}`).join('\n');
  return value === undefined || value === null ? '' : String(value);
}
