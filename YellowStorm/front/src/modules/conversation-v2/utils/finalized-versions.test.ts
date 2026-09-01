import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../types';
import {
  finalizedVersionsFromEvents,
  formatFinalizedDate,
  mergeFinalizedVersions,
  resolveLatestFinalizedRevisionId,
} from './finalized-versions';

describe('finalized-versions utils', () => {
  it('derives finalized versions from application_component events', () => {
    const events: AgentEvent[] = [
      {
        type: 'application_component',
        event_id: 'evt-1',
        timestamp: 1_756_700_000,
        url: 'nodepod://preview',
        title: 'App v1',
        revision_id: 'rev_7',
        file_count: 10,
      },
      {
        type: 'application_component',
        event_id: 'evt-2',
        timestamp: 1_756_800_000,
        url: 'nodepod://preview',
        title: 'App v2',
        revision_id: 'rev_12',
      },
    ];

    const items = finalizedVersionsFromEvents(events);

    expect(items.map((i) => i.revisionId)).toEqual(['rev_12', 'rev_7']);
    expect(items[1]?.fileCount).toBe(10);
  });

  it('merges api and event sources with dedupe by revisionId', () => {
    const merged = mergeFinalizedVersions(
      [{ revisionId: 'rev_7', title: 'API', finalizedAt: '2026-09-01T10:00:00.000Z' }],
      [{ revisionId: 'rev_7', title: 'Event', finalizedAt: '2026-09-01T11:00:00.000Z' }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('Event');
  });

  it('formats finalized date for locale', () => {
    expect(formatFinalizedDate('2026-09-01T10:00:00.000Z', 'fr-FR')).toMatch(/\d/);
  });

  it('resolves latest finalized revision id', () => {
    expect(
      resolveLatestFinalizedRevisionId([
        { revisionId: 'rev_12', title: 'A', finalizedAt: '2026-09-02T00:00:00.000Z' },
        { revisionId: 'rev_7', title: 'B', finalizedAt: '2026-09-01T00:00:00.000Z' },
      ]),
    ).toBe('rev_12');
  });
});
