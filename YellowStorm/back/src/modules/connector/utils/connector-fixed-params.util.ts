export interface ConnectorActionSchemaContract {
  key: string;
  parameterSchema?: Record<string, unknown>;
}

export function getAllowedFixedParamKeys(
  actions: ConnectorActionSchemaContract[],
): string[] | null {
  let allowed: Set<string> | null = null;

  for (const action of actions) {
    const actionKeys = getSchemaPropertyKeys(action.parameterSchema);
    allowed = intersectKeyPolicies(allowed, actionKeys);
  }

  return allowed === null ? null : [...allowed].sort();
}

export function filterConnectorFixedParams(
  fixedParams: Record<string, unknown>,
  actions: ConnectorActionSchemaContract[],
): Record<string, unknown> {
  const allowedKeys = getAllowedFixedParamKeys(actions);
  if (allowedKeys === null) {
    return fixedParams;
  }

  const allowed = new Set(allowedKeys);
  return Object.fromEntries(Object.entries(fixedParams).filter(([key]) => allowed.has(key)));
}

export function connectorActionContractsEqual(
  left: ConnectorActionSchemaContract[],
  right: ConnectorActionSchemaContract[],
): boolean {
  return stableStringify(normalizeContracts(left)) === stableStringify(normalizeContracts(right));
}

function normalizeContracts(actions: ConnectorActionSchemaContract[]): ConnectorActionSchemaContract[] {
  return actions
    .map((action) => ({ key: action.key, parameterSchema: action.parameterSchema ?? {} }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function getSchemaPropertyKeys(schema: unknown): Set<string> | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }

  const objectSchema = schema as Record<string, unknown>;
  if ('$ref' in objectSchema || 'patternProperties' in objectSchema) {
    return null;
  }
  if (objectSchema.additionalProperties === true || isObject(objectSchema.additionalProperties)) {
    return null;
  }

  let allowed: Set<string> | null = null;
  if (objectSchema.additionalProperties === false) {
    allowed = new Set(isObject(objectSchema.properties) ? Object.keys(objectSchema.properties) : []);
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = objectSchema[keyword];
    if (!Array.isArray(branches)) continue;

    let branchPolicy: Set<string> | null = null;
    for (const branch of branches) {
      const branchKeys = getSchemaPropertyKeys(branch);
      branchPolicy = intersectKeyPolicies(branchPolicy, branchKeys);
    }
    allowed = intersectKeyPolicies(allowed, branchPolicy);
  }

  return allowed;
}

function intersectKeyPolicies(
  left: Set<string> | null,
  right: Set<string> | null,
): Set<string> | null {
  if (left === null) return right;
  if (right === null) return left;
  return new Set([...left].filter((key) => right.has(key)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
