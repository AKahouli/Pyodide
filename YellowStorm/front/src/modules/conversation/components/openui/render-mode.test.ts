import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageContentPart } from '@/components/ai-elements/ai-message-content';
import { resolveAnswerRenderMode, segmentAnswerParts } from './render-mode';

afterEach(() => vi.unstubAllEnvs());

describe('resolveAnswerRenderMode', () => {
  it('stays on markdown when the feature flag is off, whatever the slug', () => {
    // .env may enable the flag for local development; the default build has it off.
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', '');
    // .env may enable the flag for local development; the default build has it off.
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', '');
    expect(resolveAnswerRenderMode({ slug: 'openui-experiment' })).toBe('markdown');
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'false');
    expect(resolveAnswerRenderMode({ slug: 'openui-experiment' })).toBe('markdown');
  });

  it('switches to OpenUI for openui- agents when the flag is on', () => {
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
    expect(resolveAnswerRenderMode({ slug: 'openui-experiment' })).toBe('openui');
  });

  it('keeps markdown for other agents and for an unresolved agent', () => {
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
    expect(resolveAnswerRenderMode({ slug: 'research-assistant' })).toBe('markdown');
    expect(resolveAnswerRenderMode({ slug: undefined as never })).toBe('markdown');
    expect(resolveAnswerRenderMode(undefined)).toBe('markdown');
  });
});

describe('segmentAnswerParts', () => {
  const text = (content: string): MessageContentPart => ({ type: 'text', content });
  const code: MessageContentPart = { type: 'code', content: 'x', language: 'ts' };

  it('turns each text part into its own OpenUI segment and groups the rest', () => {
    const segments = segmentAnswerParts([text('a'), code, code, text('b')]);
    expect(segments).toEqual([
      { kind: 'openui', content: 'a', isLast: false },
      { kind: 'parts', parts: [code, code] },
      { kind: 'openui', content: 'b', isLast: true },
    ]);
  });

  it('marks only the final text segment as last, even when followed by other parts', () => {
    const segments = segmentAnswerParts([text('a'), code]);
    expect(segments[0]).toMatchObject({ kind: 'openui', isLast: true });
  });
});
