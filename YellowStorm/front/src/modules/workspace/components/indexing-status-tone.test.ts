import { describe, expect, it } from 'vitest';
import { INDEXING_TONE, statusFilterTone } from './indexing-status-tone';

describe('indexing status tones', () => {
  it('gives each state its own colour, and keeps the idle state neutral', () => {
    expect(INDEXING_TONE.inProgress.text).toContain('orange');
    expect(INDEXING_TONE.failed.text).toContain('destructive');
    expect(INDEXING_TONE.done.text).toContain('green');
    expect(INDEXING_TONE.idle.text).toContain('muted-foreground');
  });

  it('keeps the three state colours distinct', () => {
    const texts = [INDEXING_TONE.inProgress.text, INDEXING_TONE.failed.text, INDEXING_TONE.done.text];
    expect(new Set(texts).size).toBe(3);
  });

  it('gives every state a dot colour', () => {
    for (const tone of Object.values(INDEXING_TONE)) expect(tone.dot).toMatch(/^bg-/);
  });

  it('maps every status filter value to a tone', () => {
    expect(statusFilterTone('failed')).toBe('failed');
    expect(statusFilterTone('ready')).toBe('done');
    expect(statusFilterTone('processing')).toBe('inProgress');
    expect(statusFilterTone('pending')).toBe('inProgress');
    expect(statusFilterTone('none')).toBe('idle');
    expect(statusFilterTone('all')).toBe('idle');
  });
});
