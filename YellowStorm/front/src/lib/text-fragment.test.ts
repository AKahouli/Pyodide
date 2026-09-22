import { describe, expect, it } from 'vitest';
import { buildTextFragmentUrl } from './text-fragment';

describe('buildTextFragmentUrl', () => {
  it('builds a Unicode selector while preserving query and anchor', () => {
    expect(buildTextFragmentUrl('https://example.com/page?q=1#section', {
      exact: 'Résultat net +38 %', prefix: 'Avant', suffix: 'Après',
    })).toBe('https://example.com/page?q=1#section:~:text=Avant-,R%C3%A9sultat%20net%20%2B38%20%25,-Apr%C3%A8s');
  });

  it('replaces an existing text directive', () => {
    expect(buildTextFragmentUrl('https://example.com/#section:~:text=old', { exact: 'new' }))
      .toBe('https://example.com/#section:~:text=new');
  });

  it('bounds long evidence to a word-safe selector', () => {
    expect(buildTextFragmentUrl('https://example.com/article', {
      exact: 'Python 3.14 is the latest stable release of the Python programming language.',
      suffix: 'Next sentence',
    })).toBe('https://example.com/article#:~:text=Python%203.14%20is%20the%20latest%20stable%20release%20of%20the');
  });

  it('returns the source URL when exact text is absent', () => {
    expect(buildTextFragmentUrl('https://example.com/article', { exact: '' })).toBe('https://example.com/article');
  });

  it.each(['javascript:alert(1)', 'file:///tmp/a', 'not a URL'])('rejects unsafe or invalid URLs', (url) => {
    expect(() => buildTextFragmentUrl(url, { exact: 'x' })).toThrow();
  });
});
