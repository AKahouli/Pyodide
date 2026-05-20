import { ConversationV2ShareService } from './conversation-v2-share.service';

describe('ConversationV2ShareService', () => {
  const svc = new ConversationV2ShareService();

  it('issues a token + hash pair', () => {
    const { token, hash } = svc.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hash).not.toBe(token);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('hash of the same token is stable', () => {
    const { token, hash } = svc.issue();
    expect(svc.hashToken(token)).toBe(hash);
  });

  it('verify is constant-time and accepts only the right token', () => {
    const { token, hash } = svc.issue();
    expect(svc.verify(token, hash)).toBe(true);
    expect(svc.verify(token + 'x', hash)).toBe(false);
    expect(svc.verify('', hash)).toBe(false);
  });
});
