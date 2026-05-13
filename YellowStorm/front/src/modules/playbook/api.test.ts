import { describe, expect, it } from 'vitest';
import { sanitizePlaybookUpdate } from './api';
import { makeTask } from './test-utils';

describe('sanitizePlaybookUpdate', () => {
  it('keeps iterator layout dimensions in task payloads', () => {
    const sanitized = sanitizePlaybookUpdate({
      tasks: [
        makeTask({
          id: 'iterator-1',
          taskType: 'iterator',
          iteratorLayout: { width: 720, height: 560 },
        }),
      ],
    });

    expect(sanitized.tasks).toEqual([
      expect.objectContaining({
        id: 'iterator-1',
        iteratorLayout: { width: 720, height: 560 },
      }),
    ]);
  });
});
