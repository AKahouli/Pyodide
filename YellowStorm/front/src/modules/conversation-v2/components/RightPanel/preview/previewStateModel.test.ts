import { describe, expect, it } from 'vitest';
import { resolvePreviewPhase, isPreviewBusy } from './previewStateModel';
import type { RuntimeHostStatus } from '../../../runtime/runtime.types';

const ALL_STATUSES: RuntimeHostStatus[] = [
  'idle',
  'connecting',
  'registering',
  'hydrating',
  'installing',
  'starting',
  'ready',
  'error',
  'disconnected',
];

describe('resolvePreviewPhase', () => {
  it('keeps every slow boot phase distinct instead of collapsing to one spinner', () => {
    // The coarse NodepodPreviewStatus folds connecting/registering/hydrating into
    // a single `loading`; this model must not, or hydration (the Ceph download)
    // becomes invisible.
    expect(resolvePreviewPhase('connecting').kind).toBe('connecting');
    expect(resolvePreviewPhase('registering').kind).toBe('registering');
    expect(resolvePreviewPhase('hydrating').kind).toBe('hydrating');
  });

  it('marks the in-flight phases as animated and not retryable', () => {
    for (const status of ['connecting', 'registering', 'hydrating', 'installing', 'starting'] as const) {
      const phase = resolvePreviewPhase(status);
      expect(phase.animated).toBe(true);
      expect(phase.tone).toBe('busy');
      expect(phase.showRetry).toBe(false);
    }
  });

  it('treats both error and disconnected as a non-animated retryable error', () => {
    for (const status of ['error', 'disconnected'] as const) {
      const phase = resolvePreviewPhase(status);
      expect(phase.kind).toBe('error');
      expect(phase.animated).toBe(false);
      expect(phase.tone).toBe('error');
      expect(phase.showRetry).toBe(true);
    }
  });

  it('resolves ready to idle so the real iframe owns the surface', () => {
    const phase = resolvePreviewPhase('ready');
    expect(phase.kind).toBe('idle');
    expect(phase.animated).toBe(false);
  });

  it('gives every busy phase a label and a distinct icon', () => {
    const busy = ['connecting', 'registering', 'hydrating', 'installing', 'starting'] as const;
    const icons = busy.map((status) => resolvePreviewPhase(status).icon);
    expect(new Set(icons).size).toBe(busy.length);
    for (const status of busy) {
      expect(resolvePreviewPhase(status).labelKey).toMatch(/^nodepod\./);
    }
  });

  it('always resolves to a renderable phase for every known status', () => {
    for (const status of ALL_STATUSES) {
      const phase = resolvePreviewPhase(status);
      expect(phase.labelKey).toBeTruthy();
      expect(phase.icon).toBeDefined();
    }
  });
});

describe('isPreviewBusy', () => {
  it('is true only while the runtime is working toward a live preview', () => {
    expect(isPreviewBusy('hydrating')).toBe(true);
    expect(isPreviewBusy('starting')).toBe(true);
    expect(isPreviewBusy('ready')).toBe(false);
    expect(isPreviewBusy('idle')).toBe(false);
    expect(isPreviewBusy('error')).toBe(false);
  });
});
