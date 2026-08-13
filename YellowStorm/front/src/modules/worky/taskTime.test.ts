import { describe, it, expect } from 'vitest';
import { resolveTaskTime, formatRelativeTime } from './taskTime';
import type { WorkyTask } from './types';

type Input = Pick<WorkyTask, 'lane' | 'createdAt' | 'updatedAt' | 'startedAt' | 'completedAt'>;
const task = (over: Partial<Input>): Input => ({
  lane: 'backlog',
  createdAt: '2026-08-13T10:00:00.000Z',
  updatedAt: '2026-08-13T10:05:00.000Z',
  startedAt: null,
  completedAt: null,
  ...over,
});

describe('resolveTaskTime', () => {
  it('backlog/ready → created (createdAt)', () => {
    expect(resolveTaskTime(task({ lane: 'backlog' }))).toEqual({ kind: 'created', iso: '2026-08-13T10:00:00.000Z' });
    expect(resolveTaskTime(task({ lane: 'ready' }))?.kind).toBe('created');
  });

  it('running/review → started, using startedAt when present', () => {
    expect(resolveTaskTime(task({ lane: 'running', startedAt: '2026-08-13T10:02:00.000Z' }))).toEqual({
      kind: 'started',
      iso: '2026-08-13T10:02:00.000Z',
    });
  });

  it('running → started, falling back to updatedAt when startedAt is null', () => {
    expect(resolveTaskTime(task({ lane: 'running', startedAt: null }))).toEqual({
      kind: 'started',
      iso: '2026-08-13T10:05:00.000Z',
    });
  });

  it('done → done, using completedAt then updatedAt', () => {
    expect(resolveTaskTime(task({ lane: 'done', completedAt: '2026-08-13T10:09:00.000Z' }))).toEqual({
      kind: 'done',
      iso: '2026-08-13T10:09:00.000Z',
    });
    expect(resolveTaskTime(task({ lane: 'done', completedAt: null }))).toEqual({
      kind: 'done',
      iso: '2026-08-13T10:05:00.000Z',
    });
  });

  it('returns null when no timestamp is available', () => {
    expect(resolveTaskTime(task({ lane: 'backlog', createdAt: null, updatedAt: null }))).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  it('returns a suffixed English string for a past time', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(oneHourAgo, 'en')).toMatch(/ago$/);
  });

  it('localizes to French', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(oneHourAgo, 'fr-FR')).toMatch(/^il y a/);
  });

  it('returns empty string for an invalid date', () => {
    expect(formatRelativeTime('not-a-date', 'en')).toBe('');
  });
});
