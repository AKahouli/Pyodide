import { createVerify, generateKeyPairSync } from 'node:crypto';
import { signAgentMcpToken } from './agent-mcp-jwt.util';

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('signAgentMcpToken', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  it('produces a verifiable RS256 JWT carrying agentId, userId and exp', () => {
    const token = signAgentMcpToken({
      privateKeyPem: privateKey,
      claims: { agentId: 'agent-1', userId: 'user-1' },
      ttlSeconds: 120,
      nowMs: 1_700_000_000_000,
    });

    const [header, payload, signature] = token.split('.');
    expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeSegment(payload)).toMatchObject({
      agentId: 'agent-1',
      userId: 'user-1',
      iat: 1_700_000_000,
      exp: 1_700_000_120,
    });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('does not verify under a different key (tamper detection)', () => {
    const token = signAgentMcpToken({
      privateKeyPem: privateKey,
      claims: { agentId: 'agent-1', userId: 'user-1' },
      ttlSeconds: 60,
    });

    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const [header, payload, signature] = token.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(other.publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
  });
});
