import { describe, it, expect } from 'vitest';
import { extractUrlFromText } from './utils';

describe('extractUrlFromText', () => {
  it('accepts http/https URLs', () => {
    expect(extractUrlFromText('https://example.com/x')).toBe('https://example.com/x');
    expect(extractUrlFromText('  http://foo.bar  ')).toBe('http://foo.bar');
  });
  it('finds a URL inside surrounding text', () => {
    expect(extractUrlFromText('see https://example.com here')).toBe('https://example.com');
  });
  it('rejects non-URLs', () => {
    expect(extractUrlFromText('just some words')).toBeNull();
    expect(extractUrlFromText('ftp://nope.com')).toBeNull();
    expect(extractUrlFromText('')).toBeNull();
  });
});
