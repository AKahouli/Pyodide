import { isOwnedId, newOwnedId } from './owned-id';

describe('Conversation owned IDs', () => {
  it('accepts only canonical lowercase IDs', () => {
    expect(isOwnedId('0123456789abcdef01234567')).toBe(true);
    expect(isOwnedId('0123456789ABCDEF01234567')).toBe(false);
    expect(isOwnedId('short')).toBe(false);
  });

  it('generates canonical IDs', () => {
    const first = newOwnedId();
    expect(isOwnedId(first)).toBe(true);
    expect(newOwnedId()).not.toBe(first);
  });
});
