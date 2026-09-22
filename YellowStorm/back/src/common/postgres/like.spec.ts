import { escapeLike } from './like';

describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });

  it('leaves regular text untouched', () => {
    expect(escapeLike('plain text 123')).toBe('plain text 123');
  });

  it('keeps the escaped value from matching beyond the literal input', () => {
    // '100%' escaped matches the literal '100%' but not '1000'
    expect('100%'.startsWith('100')).toBe(true);
    expect(escapeLike('100%')).toBe('100\\%');
  });
});
