import { createHash } from 'crypto';
import { RuntimeTokenService } from './runtime-token.service';

describe('RuntimeTokenService', () => {
  const service = new RuntimeTokenService();

  it('issues a token whose hash is its SHA-256 digest', () => {
    const { token, hash } = service.issue();

    expect(token).not.toHaveLength(0);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('issues a distinct token on every call', () => {
    const first = service.issue();
    const second = service.issue();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });

  it('hashes deterministically so a presented token can be looked up', () => {
    expect(service.hash('abc')).toBe(service.hash('abc'));
  });
});
