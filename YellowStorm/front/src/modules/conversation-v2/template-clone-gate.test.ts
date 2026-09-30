import { describe, expect, it } from 'vitest';
import type { AgentEvent } from './types';
import {
  hasUserMessage,
  isTemplateCloneNavigation,
  isTemplateCloneSession,
  shouldGateTemplateClonePreview,
} from './template-clone-gate';

describe('template-clone-gate', () => {
  it('detects Clone App navigation without an auto-prompt', () => {
    expect(
      isTemplateCloneNavigation({
        source: 'template-clone',
        templateId: 'tpl-1',
      }),
    ).toBe(true);
    expect(
      isTemplateCloneNavigation({
        templateId: 'tpl-1',
      }),
    ).toBe(true);
    expect(
      isTemplateCloneNavigation({
        source: 'app-builder',
        templateId: 'tpl-1',
        initialMessage: 'customize',
      }),
    ).toBe(false);
    expect(isTemplateCloneNavigation(null)).toBe(false);
  });

  it('treats template_<id> starter revisions as clone sessions (reload)', () => {
    expect(
      isTemplateCloneSession({
        latchedFromNav: false,
        starterRevisionId: 'template_tpl-1',
      }),
    ).toBe(true);
    expect(
      isTemplateCloneSession({
        latchedFromNav: false,
        starterRevisionId: 'starter_react_vite_v6',
      }),
    ).toBe(false);
    expect(
      isTemplateCloneSession({
        latchedFromNav: true,
        starterRevisionId: null,
      }),
    ).toBe(true);
  });

  it('gates Send until preview is ready, and never when a user message exists', () => {
    expect(
      shouldGateTemplateClonePreview({
        isTemplateCloneSession: true,
        hasInitialMessage: false,
        hasUserMessage: false,
        canWrite: true,
      }),
    ).toBe(true);

    expect(
      shouldGateTemplateClonePreview({
        isTemplateCloneSession: true,
        hasInitialMessage: true,
        hasUserMessage: false,
        canWrite: true,
      }),
    ).toBe(false);

    expect(
      shouldGateTemplateClonePreview({
        isTemplateCloneSession: true,
        hasInitialMessage: false,
        hasUserMessage: true,
        canWrite: true,
      }),
    ).toBe(false);

    expect(
      shouldGateTemplateClonePreview({
        isTemplateCloneSession: false,
        hasInitialMessage: false,
        hasUserMessage: false,
        canWrite: true,
      }),
    ).toBe(false);
  });

  it('detects user messages in the event stream', () => {
    const events: AgentEvent[] = [
      {
        type: 'message',
        event_id: 'u1',
        timestamp: 1,
        role: 'user',
        content: 'edit the hero',
      },
    ];
    expect(hasUserMessage(events)).toBe(true);
    expect(hasUserMessage([])).toBe(false);
  });
});
