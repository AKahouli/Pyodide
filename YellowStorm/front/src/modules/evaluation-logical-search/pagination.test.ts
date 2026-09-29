import { describe, expect, it } from 'vitest';
import { buildPageWindow } from './pagination';

describe('buildPageWindow', () => {
  it('keeps short ranges contiguous', () => {
    expect(buildPageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('truncates a long range around the current page', () => {
    expect(buildPageWindow(5, 31)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 31]);
  });

  it('always includes the first and last page', () => {
    expect(buildPageWindow(1, 31)).toEqual([1, 2, 'ellipsis', 31]);
    expect(buildPageWindow(31, 31)).toEqual([1, 'ellipsis', 30, 31]);
  });
});
