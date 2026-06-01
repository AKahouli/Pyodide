/** Maps plain JSON values into proto-loader's explicit google.protobuf.Struct shape. */
export function toGrpcValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { nullValue: 'NULL_VALUE', kind: 'nullValue' };
  }
  if (Array.isArray(value)) {
    return {
      listValue: { values: value.map((item) => toGrpcValue(item)) },
      kind: 'listValue',
    };
  }
  switch (typeof value) {
    case 'string':
      return { stringValue: value, kind: 'stringValue' };
    case 'number':
      return { numberValue: value, kind: 'numberValue' };
    case 'boolean':
      return { boolValue: value, kind: 'boolValue' };
    case 'object':
      return {
        structValue: toGrpcStruct(value as Record<string, unknown>),
        kind: 'structValue',
      };
    default:
      return { stringValue: String(value), kind: 'stringValue' };
  }
}

export function toGrpcStruct(value?: Record<string, unknown>): Record<string, unknown> {
  const fields = Object.entries(value || {}).reduce<Record<string, unknown>>((acc, [key, entry]) => {
    acc[key] = toGrpcValue(entry);
    return acc;
  }, {});
  return { fields };
}

export function buildGrpcHumanApprovalConfig(config?: { promptTemplate?: string; timeoutSeconds?: number | null } | null) {
  if (!config) return undefined;
  return {
    prompt_template: config.promptTemplate || '',
    ...(config.timeoutSeconds == null || config.timeoutSeconds === 0 ? {} : { timeout_seconds: config.timeoutSeconds }),
  };
}

/**
 * Converts proto-loader Struct/Value payloads back into plain JSON.
 *
 * Runtime events can arrive as explicit protobuf wrappers or already-unwrapped
 * plain objects depending on proto-loader behavior. This mapper normalizes both
 * shapes at the gRPC boundary so event handlers can work with domain payloads.
 */
export function fromGrpcValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => fromGrpcValue(entry));

  const grpcValue = value as Record<string, unknown>;
  const selector = typeof grpcValue.kind === 'string' ? grpcValue.kind : undefined;
  const explicitValue = unwrapExplicitGrpcValue(grpcValue, selector);
  if (explicitValue !== undefined) return explicitValue;

  const plainValue: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(grpcValue)) {
    plainValue[key] = fromGrpcValue(entry);
  }
  return plainValue;
}

function unwrapExplicitGrpcValue(value: Record<string, unknown>, selector?: string): unknown {
  if (isStructValue(value, selector)) {
    return unwrapStructFields(value.fields as Record<string, unknown>);
  }
  if (isNestedStructValue(value, selector)) {
    return fromGrpcValue(value.structValue);
  }
  if (isListValue(value, selector)) {
    const values = (value.listValue as { values?: unknown[] }).values ?? [];
    return values.map((entry) => fromGrpcValue(entry));
  }
  if (isScalarValue(value, selector, 'numberValue')) return value.numberValue ?? 0;
  if (isScalarValue(value, selector, 'stringValue')) return value.stringValue ?? '';
  if (isScalarValue(value, selector, 'boolValue')) return Boolean(value.boolValue);
  if (selector === 'nullValue' || (!selector && 'nullValue' in value)) return null;
  return undefined;
}

function unwrapStructFields(fields: Record<string, unknown>): Record<string, unknown> {
  const plainValue: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(fields)) {
    plainValue[key] = fromGrpcValue(entry);
  }
  return plainValue;
}

function isStructValue(value: Record<string, unknown>, selector?: string): boolean {
  return (selector === undefined || selector === 'structValue')
    && typeof value.fields === 'object'
    && value.fields !== null
    && !Array.isArray(value.fields);
}

function isNestedStructValue(value: Record<string, unknown>, selector?: string): boolean {
  return selector === 'structValue'
    && typeof value.structValue === 'object'
    && value.structValue !== null
    && !Array.isArray(value.structValue);
}

function isListValue(value: Record<string, unknown>, selector?: string): boolean {
  const listValue = value.listValue as { values?: unknown[] } | undefined;
  return (selector === undefined || selector === 'listValue')
    && typeof listValue === 'object'
    && listValue !== null
    && Array.isArray(listValue.values);
}

function isScalarValue(value: Record<string, unknown>, selector: string | undefined, key: string): boolean {
  return selector === key || (!selector && key in value);
}
