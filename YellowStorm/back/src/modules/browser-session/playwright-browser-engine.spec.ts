import { isNavigationRequestBlocked, resolveClickLabel } from './playwright-browser-engine';

describe('isNavigationRequestBlocked', () => {
  const safe = async (u: string) => { if (u.includes('169.254')) throw new Error('blocked'); };

  it('blocks a document navigation to an unsafe host', async () => {
    expect(await isNavigationRequestBlocked(safe, 'document', 'http://169.254.169.254/')).toBe(true);
  });

  it('allows a document navigation to a safe host', async () => {
    expect(await isNavigationRequestBlocked(safe, 'document', 'https://example.com/')).toBe(false);
  });

  it('does not block sub-resources (only main-frame documents are checked)', async () => {
    expect(await isNavigationRequestBlocked(safe, 'image', 'http://169.254.169.254/x.png')).toBe(false);
  });
});

describe('resolveClickLabel', () => {
  it('returns the recorded label inside the ttl window', () => {
    expect(resolveClickLabel({ label: 'Our Services', at: 1000 }, 3000, 5000)).toBe('Our Services');
  });

  it('returns undefined when the click is older than the ttl', () => {
    expect(resolveClickLabel({ label: 'Our Services', at: 1000 }, 7000, 5000)).toBeUndefined();
  });

  it('returns undefined when there is no recorded click', () => {
    expect(resolveClickLabel(undefined, 3000, 5000)).toBeUndefined();
  });
});
