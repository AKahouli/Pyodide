import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageContentPart } from '@/components/ai-elements/ai-message-content';
import { looksLikeOpenUiProgram, resolveAnswerRenderMode, segmentAnswerParts } from './render-mode';

afterEach(() => vi.unstubAllEnvs());

describe('resolveAnswerRenderMode', () => {
  it('stays on markdown when the kill switch is off, whatever the agent toggle', () => {
    // .env may enable the flag for local development; the default build has it off.
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', '');
    expect(resolveAnswerRenderMode({ genUiEnabled: true })).toBe('markdown');
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'false');
    expect(resolveAnswerRenderMode({ genUiEnabled: true })).toBe('markdown');
  });

  it('switches to OpenUI for an agent with generative UI on when the kill switch is on', () => {
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
    expect(resolveAnswerRenderMode({ genUiEnabled: true })).toBe('openui');
  });

  it('keeps markdown for an agent with the toggle off or unset and for an unresolved agent, whatever its slug', () => {
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
    expect(resolveAnswerRenderMode({ genUiEnabled: false })).toBe('markdown');
    expect(resolveAnswerRenderMode({})).toBe('markdown');
    expect(resolveAnswerRenderMode({ slug: 'openui-experiment' } as never)).toBe('markdown');
    expect(resolveAnswerRenderMode(undefined)).toBe('markdown');
    expect(resolveAnswerRenderMode(null)).toBe('markdown');
  });
});

describe('looksLikeOpenUiProgram', () => {
  it('recognises a chat or report program root and nothing else', () => {
    expect(looksLikeOpenUiProgram('root = Card([a])\na = TextContent("x")')).toBe(true);
    expect(looksLikeOpenUiProgram('\n  root=Report({title: "x"}, [])')).toBe(true);
    expect(looksLikeOpenUiProgram('# Title\n\nroot = Card(')).toBe(false);
    expect(looksLikeOpenUiProgram('The root = Card( is the entry point')).toBe(false);
    expect(looksLikeOpenUiProgram('Plain markdown answer')).toBe(false);
  });
});

describe('segmentAnswerParts', () => {
  const text = (content: string): MessageContentPart => ({ type: 'text', content });
  const code: MessageContentPart = { type: 'code', content: 'x', language: 'ts' };

  it('turns each text part into its own OpenUI segment and groups the rest', () => {
    const segments = segmentAnswerParts([text('a'), code, code, text('b')], 'openui');
    expect(segments).toEqual([
      { kind: 'openui', content: 'a', isLast: false },
      { kind: 'parts', parts: [code, code] },
      { kind: 'openui', content: 'b', isLast: true },
    ]);
  });

  it('marks only the final text segment as last, even when followed by other parts', () => {
    const segments = segmentAnswerParts([text('a'), code], 'openui');
    expect(segments[0]).toMatchObject({ kind: 'openui', isLast: true });
  });

  it('in markdown mode keeps every part as is, except stored OpenUI programs', () => {
    expect(segmentAnswerParts([text('Plain *markdown*'), code], 'markdown')).toEqual([{ kind: 'parts', parts: [text('Plain *markdown*'), code] }]);

    const programText = 'root = Card([a])\na = TextContent("x")';
    const program = text(programText);
    expect(segmentAnswerParts([text('Intro'), code, program], 'markdown')).toEqual([
      { kind: 'parts', parts: [text('Intro'), code] },
      { kind: 'openui', content: programText, isLast: true },
    ]);
  });
});
