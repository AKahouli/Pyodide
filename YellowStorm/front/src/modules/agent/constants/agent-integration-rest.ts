export interface IntegrationRestHeaderRow {
  key: string;
  value: string;
}

export interface IntegrationRestSpec {
  method: 'POST';
  url: string;
  headers: IntegrationRestHeaderRow[];
  body: string;
  responseStatus: number;
  responseBody: string;
}

export function isIntegrationRestSpec(value: unknown): value is IntegrationRestSpec {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as IntegrationRestSpec;
  return (
    candidate.method === 'POST' &&
    typeof candidate.url === 'string' &&
    Array.isArray(candidate.headers) &&
    typeof candidate.body === 'string' &&
    typeof candidate.responseStatus === 'number' &&
    typeof candidate.responseBody === 'string'
  );
}

export function getIntegrationMessagesUrl(apiBase: string, agentId: string): string {
  return `${apiBase.replace(/\/$/, '')}/integrations/agents/${agentId}/messages`;
}

/** REST integration contract (not /widget/*). */
export function buildAgentIntegrationRestSpec(
  apiBase: string,
  agentId: string,
  token: string,
): IntegrationRestSpec {
  return {
    method: 'POST',
    url: getIntegrationMessagesUrl(apiBase, agentId),
    headers: [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: `Bearer ${token}` },
    ],
    body: JSON.stringify({ message: 'Hello' }, null, 2),
    responseStatus: 200,
    responseBody: JSON.stringify(
      {
        success: true,
        data: {
          sessionId: '67a1b2c3d4e5f6789012345',
          messageId: '67a1b2c3d4e5f6789012346',
          reply: 'Hello! How can I help you today?',
          usage: {
            inputTokens: 42,
            outputTokens: 18,
          },
        },
        timestamp: '2026-06-02T14:30:00.000Z',
      },
      null,
      2,
    ),
  };
}

export function formatIntegrationRestSpecForCopy(spec: IntegrationRestSpec): string {
  const headerBlock = spec.headers.map((h) => `${h.key}: ${h.value}`).join('\n');
  return [
    `${spec.method} ${spec.url}`,
    '',
    'Headers',
    headerBlock,
    '',
    'Body',
    spec.body,
    '',
    `Response ${spec.responseStatus}`,
    spec.responseBody,
  ].join('\n');
}
