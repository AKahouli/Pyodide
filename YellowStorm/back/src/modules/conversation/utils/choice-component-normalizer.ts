export type ChoicePresentation = 'quick_replies' | 'list';
export type ChoiceSelectionMode = 'single' | 'multiple';
export type ChoiceSubmitBehavior = 'immediate' | 'explicit';
export type ChoiceStatus = 'ready' | 'submitted' | 'disabled';

export interface ChoiceComponentData extends Record<string, unknown> {
  schemaVersion: 1;
  questionId: string;
  prompt: string;
  description?: string;
  presentation: ChoicePresentation;
  selectionMode: ChoiceSelectionMode;
  submitBehavior: ChoiceSubmitBehavior;
  options: Array<{ id: string; label: string; submitText: string; value?: string; description?: string; disabled?: boolean }>;
  otherOption?: { enabled: boolean; label: string; placeholder?: string; maxLength: number };
  labels?: { submit?: string; dismiss?: string; other?: string };
  progress?: { current: number; total: number; label?: string };
  dismissible?: boolean;
  fallbackText?: string;
  status: ChoiceStatus;
}

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function text(value: unknown, max: number, required = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length > max) return undefined;
  return normalized || undefined;
}

function field(data: Record<string, unknown>, camel: string, snake: string): unknown {
  return data[camel] ?? data[snake];
}

/** Normalizes untrusted producer data before it reaches persistence or a public renderer. */
export function normalizeChoiceComponentData(raw: unknown): ChoiceComponentData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (field(data, 'schemaVersion', 'schema_version') !== 1) return null;
  const questionId = text(field(data, 'questionId', 'question_id'), 100, true);
  const prompt = text(data.prompt, 500, true);
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  if (!questionId || !prompt || rawOptions.length < 2 || rawOptions.length > 10) return null;

  const ids = new Set<string>();
  const options: ChoiceComponentData['options'] = [];
  for (const rawOption of rawOptions) {
    if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) return null;
    const option = rawOption as Record<string, unknown>;
    const id = text(option.id, 64, true);
    const label = text(option.label, 160, true);
    const submitText = text(field(option, 'submitText', 'submit_text'), 1000, true);
    if (!id || !ID_PATTERN.test(id) || ids.has(id) || !label || !submitText) return null;
    ids.add(id);
    const value = text(option.value, 200);
    const description = text(option.description, 1000);
    options.push({ id, label, submitText, ...(value ? { value } : {}), ...(description ? { description } : {}), ...(option.disabled === true ? { disabled: true } : {}) });
  }

  const presentation: ChoicePresentation = data.presentation === 'list' ? 'list' : 'quick_replies';
  const selectionMode: ChoiceSelectionMode = data.selectionMode === 'multiple' || data.selection_mode === 'multiple' ? 'multiple' : 'single';
  const rawOther = field(data, 'otherOption', 'other_option');
  let otherOption: ChoiceComponentData['otherOption'];
  if (rawOther && typeof rawOther === 'object' && !Array.isArray(rawOther)) {
    const other = rawOther as Record<string, unknown>;
    if (other.enabled === true) {
      const label = text(other.label, 160, true);
      const maxLength = typeof other.maxLength === 'number' ? other.maxLength : typeof other.max_length === 'number' ? other.max_length : 500;
      if (!label || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 2000) return null;
      const placeholder = text(other.placeholder, 500);
      otherOption = { enabled: true, label, maxLength, ...(placeholder ? { placeholder } : {}) };
    }
  }
  const submitBehavior: ChoiceSubmitBehavior = selectionMode === 'multiple' || otherOption?.enabled || presentation === 'list'
    ? 'explicit'
    : data.submitBehavior === 'explicit' || data.submit_behavior === 'explicit' ? 'explicit' : 'immediate';
  const status: ChoiceStatus = data.status === 'submitted' || data.status === 'disabled' ? data.status : 'ready';
  const description = text(data.description, 1500);
  const fallbackText = text(field(data, 'fallbackText', 'fallback_text'), 2000);
  const rawLabels = data.labels;
  const labels = rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)
    ? { ...(text((rawLabels as Record<string, unknown>).submit, 100) ? { submit: text((rawLabels as Record<string, unknown>).submit, 100)! } : {}), ...(text((rawLabels as Record<string, unknown>).dismiss, 100) ? { dismiss: text((rawLabels as Record<string, unknown>).dismiss, 100)! } : {}), ...(text((rawLabels as Record<string, unknown>).other, 100) ? { other: text((rawLabels as Record<string, unknown>).other, 100)! } : {}) }
    : undefined;
  const rawProgress = data.progress;
  const progress = rawProgress && typeof rawProgress === 'object' && !Array.isArray(rawProgress)
    ? (() => { const value = rawProgress as Record<string, unknown>; const current = value.current; const total = value.total; return typeof current === 'number' && Number.isInteger(current) && current >= 1 && typeof total === 'number' && Number.isInteger(total) && total >= current ? { current, total, ...(text(value.label, 160) ? { label: text(value.label, 160)! } : {}) } : undefined; })()
    : undefined;
  return { schemaVersion: 1, questionId, prompt, ...(description ? { description } : {}), presentation, selectionMode, submitBehavior, options, ...(otherOption ? { otherOption } : {}), ...(labels && Object.keys(labels).length ? { labels } : {}), ...(progress ? { progress } : {}), dismissible: data.dismissible === true, ...(fallbackText ? { fallbackText } : {}), status };
}
