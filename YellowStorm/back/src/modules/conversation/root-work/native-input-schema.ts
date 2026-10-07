/** A bounded data-only subset; never resolve remote schemas or UI instructions. */
export interface NativeInputSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, NativeInputSchema>;
  required?: string[];
  items?: NativeInputSchema;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

const DATA_KEYS = new Set(['type', 'properties', 'required', 'items', 'enum', 'additionalProperties',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum']);
const ANNOTATION_KEYS = new Set(['title', 'description', 'default', 'examples', '$schema', 'deprecated', 'readOnly', 'writeOnly']);

export function sanitizeNativeInputSchema(raw: unknown, depth = 0,
  budget = { fields: 0 }): NativeInputSchema | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 5) return null;
  const source = raw as Record<string, unknown>;
  if (Object.keys(source).some((key) => !DATA_KEYS.has(key) && !ANNOTATION_KEYS.has(key))) return null;
  if (source.additionalProperties !== undefined && typeof source.additionalProperties !== 'boolean') return null;
  const type = source.type;
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(String(type))) return null;
  const result: NativeInputSchema = { type: type as NativeInputSchema['type'] };
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum'] as const) {
    const bound = source[key];
    if (bound === undefined) continue;
    if (typeof bound !== 'number' || !Number.isFinite(bound)
      || !['minimum', 'maximum'].includes(key) && (!Number.isSafeInteger(bound) || bound < 0)) return null;
    result[key] = bound;
  }
  if (source.enum !== undefined) {
    if (!Array.isArray(source.enum) || source.enum.length > 20
      || source.enum.some((item) => !['string', 'number', 'boolean'].includes(typeof item)
        || typeof item === 'string' && item.length > 1000
        || typeof item === 'number' && !Number.isFinite(item))) return null;
    result.enum = source.enum;
  }
  if (type === 'object') {
    if (!source.properties || typeof source.properties !== 'object' || Array.isArray(source.properties)) return null;
    result.properties = Object.create(null) as Record<string, NativeInputSchema>;
    for (const [key, property] of Object.entries(source.properties)) {
      if (++budget.fields > 64 || !/^[A-Za-z0-9_ -]{1,100}$/.test(key)
        || ['__proto__', 'constructor', 'prototype'].includes(key)) return null;
      const child = sanitizeNativeInputSchema(property, depth + 1, budget);
      if (!child) return null;
      result.properties[key] = child;
    }
    if (source.required !== undefined && (!Array.isArray(source.required)
      || source.required.some((key) => typeof key !== 'string' || !Object.hasOwn(result.properties!, key))
      || new Set(source.required).size !== source.required.length)) return null;
    result.required = (source.required || []) as string[];
  }
  if (type === 'array') {
    const items = sanitizeNativeInputSchema(source.items, depth + 1, budget);
    if (!items) return null;
    result.items = items;
  }
  return result;
}

/** Matches the pinned ADK scalar envelope before its native schema validation. */
export function decodeNativeInputResponse(response: Record<string, unknown>): unknown {
  if (Object.keys(response).length !== 1 || !Object.hasOwn(response, 'result')) return response;
  const value = response.result;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; }
  catch { return value; }
}

export function matchesNativeInputSchema(value: unknown, schema: NativeInputSchema): boolean {
  if (schema.enum && !schema.enum.some((option) => option === value)) return false;
  switch (schema.type) {
    case 'string': return typeof value === 'string' && value.length <= 2000
      && [...value].length >= (schema.minLength ?? 0) && [...value].length <= (schema.maxLength ?? Infinity);
    case 'number':
    case 'integer': return typeof value === 'number' && Number.isFinite(value)
      && (schema.type !== 'integer' || Number.isSafeInteger(value))
      && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value) && value.length <= 20
      && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity)
      && value.every((item) => matchesNativeInputSchema(item, schema.items!));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const object = value as Record<string, unknown>;
      return (schema.required || []).every((key) => Object.hasOwn(object, key))
        && Object.entries(object).every(([key, item]) => Object.hasOwn(schema.properties!, key)
          && matchesNativeInputSchema(item, schema.properties![key]));
    }
  }
}
