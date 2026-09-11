import { createSign } from 'node:crypto';

/**
 * Signs the short-lived RS256 Bearer JWT injected into a connector's
 * auth_headers for agent-scoped MCP servers (e.g. the WhatsApp Send MCP).
 * The MCP server verifies the token with the matching public key and reads
 * `agentId` from the claims — the client can never choose it.
 */
export interface AgentMcpTokenClaims {
  agentId: string;
  userId: string;
}

export function signAgentMcpToken(params: {
  privateKeyPem: string;
  claims: AgentMcpTokenClaims;
  ttlSeconds: number;
  nowMs?: number;
}): string {
  const { privateKeyPem, claims, ttlSeconds } = params;
  const issuedAtSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);

  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');
  const encodedPayload = Buffer.from(
    JSON.stringify({
      agentId: claims.agentId,
      userId: claims.userId,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + ttlSeconds,
    }),
    'utf8',
  ).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
