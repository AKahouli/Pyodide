import { isNavigationRequestBlocked } from './playwright-browser-engine';

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
