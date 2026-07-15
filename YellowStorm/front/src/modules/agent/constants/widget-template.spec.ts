import { describe, expect, it } from 'vitest';
import { buildWidgetCdnSnippet, buildWidgetRuntimeSource, buildWidgetSnippet } from './widget-template';

describe('buildWidgetCdnSnippet', () => {
  it('returns a one-line script tag with only the token in the URL', () => {
    const snippet = buildWidgetCdnSnippet({
      embedHandle: 'embed-token',
      cdnBaseUrl: 'http://localhost:5173',
    });

    expect(snippet).toBe(
      '<script src="http://localhost:5173/widget-embed.js?token=embed-token" async></script>',
    );
  });

  it('URL-encodes the token in the script src', () => {
    const snippet = buildWidgetCdnSnippet({
      embedHandle: 't&ok',
      cdnBaseUrl: 'http://localhost:5173',
    });
    expect(snippet).toContain('token=t%26ok');
    expect(snippet).not.toContain('data-api');
    expect(snippet).not.toContain('data-token');
  });
});

describe('buildWidgetRuntimeSource', () => {
  it('bakes the API base and reads token from the script URL', () => {
    const source = buildWidgetRuntimeSource({ apiBaseUrl: 'http://localhost:3000/api/v1' });
    expect(source).toContain('document.currentScript');
    expect(source).toContain('widget-embed\\.js');
    expect(source).toContain('var __apiBase="http://localhost:3000/api/v1"');
    expect(source).toContain('__ysParam("token")');
    expect(source).toContain('payload.agentId');
    expect(source).toContain('/widget/chat');
    expect(source).not.toContain('data-api');
    expect(source).not.toContain('<script>');
  });
});

describe('buildWidgetSnippet', () => {
  function messageActionRuntime(navigatorMock: unknown, windowMock: Record<string, unknown>) {
    const snippet = buildWidgetSnippet({ agentId: 'agent-id', embedHandle: 'embed-token', apiBaseUrl: 'http://localhost:3000/api/v1' });
    const start = snippet.indexOf('function speechSynthesisAvailable()');
    const end = snippet.indexOf('function finalizeReply()', start);
    const source = snippet.slice(start, end);
    const run = new Function('navigator', 'window', 'SpeechSynthesisUtterance', `
      var toasts = [];
      var widgetPrefs = { tts: true, language: 'auto' };
      var SETTINGS = { accessibility: { readAloud: { enabled: true, defaultRate: 1 } } };
      function a11ySettings() { return SETTINGS.accessibility; }
      function label(_key, fallback) { return fallback; }
      function showToast(message) { toasts.push(message); }
      ${source}
      return { copyMessage: copyMessage, readAloud: readAloud, toasts: toasts };
    `) as (
      navigator: unknown,
      window: Record<string, unknown>,
      SpeechSynthesisUtterance: unknown,
    ) => { copyMessage: (text: string) => Promise<void>; readAloud: (text: string, button: { setAttribute: (name: string, value: string) => void; title: string }) => void; toasts: string[] };

    const actions = run(navigatorMock, windowMock, windowMock.SpeechSynthesisUtterance);
    return { actions, toasts: actions.toasts };
  }

  function reconcileChoicePrompt(text: string, prompt: string) {
    const snippet = buildWidgetSnippet({ agentId: 'agent-id', embedHandle: 'embed-token', apiBaseUrl: 'http://localhost:3000/api/v1' });
    const start = snippet.indexOf('function reconcileChoicePrompt()');
    const end = snippet.indexOf('function _ysMoveCitationsAfterText()', start);
    const source = snippet.slice(start, end);
    const run = new Function(`
      var primaryTextBuffer = ${JSON.stringify(text)};
      var streamComponents = { choice: { type: 'choice', data: { prompt: ${JSON.stringify(prompt)} } } };
      var TEXT_SLOT_KEY = 'text';
      var removed = false;
      var rendered = '';
      function findSlot() { return { remove: function() { removed = true; } }; }
      var _ysRenderers = { text: function(data) { rendered = data.content; return data.content; } };
      function upsertSlot() {}
      ${source}
      reconcileChoicePrompt();
      return { removed: removed, rendered: rendered };
    `) as () => { removed: boolean; rendered: string };

    return run();
  }

  it('removes punctuation-only residue after deduplicating a choice prompt', () => {
    expect(reconcileChoicePrompt('?\n\nFor which situation is it?', 'For which situation is it?')).toEqual({
      removed: true,
      rendered: '',
    });
  });

  it('preserves assistant text while deduplicating a choice prompt', () => {
    expect(reconcileChoicePrompt('Please select a category.\n\nFor which situation is it?', 'For which situation is it?')).toEqual({
      removed: false,
      rendered: 'Please select a category.',
    });
  });

  it('generates syntactically valid JavaScript', () => {
    const snippet = buildWidgetSnippet(
      'agent-id',
      'Test Agent',
      'embed-token',
      'http://localhost:3000/api/v1/widget/chat',
      'http://localhost:3000/api/v1/widget/stream',
    );

    const body = snippet
      .replace(/^<script>\n\(function\(\)\{/, '')
      .replace(/\}\)\(\);\n<\/script>$/, '');

    expect(() => new Function(body)).not.toThrow();
  });

  it('includes quick-reply and explicit choice submission paths', () => {
    const snippet = buildWidgetSnippet({ agentId: 'agent-id', embedHandle: 'embed-token', apiBaseUrl: 'http://localhost:3000/api/v1' });
    expect(snippet).toContain('_ysRenderers');
    expect(snippet).toContain('choice:function');
    expect(snippet).toContain('data-ys-choice-action');
    expect(snippet).toContain('selectedOptions');
    expect(snippet).toContain('customAnswer');
    expect(snippet).toContain('reconcileChoicePrompt');
    expect(snippet).toContain('remaining=remaining.split(prompt).join("")');
    expect(snippet).toContain('if(/^[?!.]+$/.test(remaining))remaining=""');
    expect(snippet).toContain('_ysSubmitChoice');
    expect(snippet).toContain('choiceSendError');
    expect(snippet).toContain('ys-choice-quick');
  });

  it('ships the table renderer and responsive table styles', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('function _ysParseTable');
    expect(snippet).toContain('function _ysRenderTable');
    expect(snippet).toContain('function _ysTableAlignment');
    expect(snippet).toContain('ys-md-table-wrap');
    expect(snippet).toContain('overflow-x:auto');
  });

  it('ships titled agent citations and compact assistant message actions', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('\\[([^,\\]\\n]+),\\s*(https?:\\/\\/[^\\]\\s]+)\\]');
    expect(snippet).toContain('function _ysMessageActionIcon(type)');
    expect(snippet).toContain('className="ys-msg-meta"');
    expect(snippet).toContain('function copyMessage(text)');
    expect(snippet).toContain('aria-label=\\"Start voice input\\"');
    expect(snippet).toContain('M12 14a3 3 0 0 0 3-3V5');
  });

  it('copies one message and reports clipboard failures', async () => {
    const copied: string[] = [];
    const success = messageActionRuntime({ clipboard: { writeText: async (text: string) => copied.push(text) } }, {});
    await success.actions.copyMessage('Assistant reply');
    expect(copied).toEqual(['Assistant reply']);
    expect(success.toasts).toEqual(['Message copied']);

    const failure = messageActionRuntime({ clipboard: { writeText: async () => { throw new Error('denied'); } } }, {});
    await failure.actions.copyMessage('Assistant reply');
    expect(failure.toasts).toEqual(['Copy failed']);
  });

  it('reports unavailable read aloud and updates its icon button while speaking', () => {
    const unavailable = messageActionRuntime({}, {});
    unavailable.actions.readAloud('Assistant reply', { setAttribute: () => {}, title: '' });
    expect(unavailable.toasts).toEqual(['Read aloud is not available in this browser']);

    let utterance: { onstart?: () => void; onend?: () => void } | undefined;
    function Utterance() {}
    const supported = messageActionRuntime({}, {
      SpeechSynthesisUtterance: Utterance,
      speechSynthesis: { cancel: () => {}, speak: (next: typeof utterance) => { utterance = next; next?.onstart?.(); } },
    });
    const attributes: Record<string, string> = {};
    const button = { setAttribute: (name: string, value: string) => { attributes[name] = value; }, title: '' };
    supported.actions.readAloud('Assistant reply', button);
    expect(attributes).toMatchObject({ 'aria-pressed': 'true', 'aria-label': 'Stop reading' });
    utterance?.onend?.();
    expect(attributes).toMatchObject({ 'aria-pressed': 'false', 'aria-label': 'Read aloud' });
  });

  it('matches the reference renderer apostrophe escaping', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('replace(/\'/g,"&#39;")');
  });

  it('mounts the self-contained widget inside a shadow root', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('host.attachShadow({mode:"open"})');
    expect(snippet).toContain('shadow.getElementById(id)');
    expect(snippet).toContain(':host{all:initial;position:fixed');
  });

  it('lets configured theme variables override the browser color scheme', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('background:var(--ys-surface)');
    expect(snippet).toContain('background:var(--ys-background)');
    expect(snippet).not.toContain('@media (prefers-color-scheme:dark)');
  });

  it('supports configured desktop dimensions and bottom-left placement', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('--ys-panel-width');
    expect(snippet).toContain('--ys-panel-height');
    expect(snippet).toContain('ys-widget-position-left');
    expect(snippet).toContain('--ys-panel-radius');
    expect(snippet).toContain('@media (max-width:900px)');
    expect(snippet).toContain('ys-mobile-open');
    expect(snippet).toContain('ys-mobile-sheet');
    expect(snippet).toContain(':host(.ys-mobile-open) #ys-widget-root');
    expect(snippet).toContain('width:100%!important;height:100%!important');
    expect(snippet).toContain('function pinStickyLauncher()');
    expect(snippet).toContain('startStickyPinLoop');
    expect(snippet).toContain('getPageScroll');
    expect(snippet).toContain('position","absolute"');
    expect(snippet).toContain('requestAnimationFrame(tick)');
  });

  it('uses the configured header foreground for header actions', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('#ys-widget-menu-btn,#ys-widget-close{background:color-mix');
    expect(snippet).toContain('color:var(--ys-header-foreground)');
  });

  it('keeps a closed dialog inert and applies configured behavior settings', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('aria-hidden=\\"true\\" hidden inert');
    expect(snippet).toContain('panel.setAttribute("inert","")');
    expect(snippet).toContain('function applyBehavior()');
    expect(snippet).toContain('allowTranscriptDownload!==false');
    expect(snippet).toContain('localStorage.setItem("ys_visitor_id",visitorId)');
  });

  it('ships labelled dialog semantics and keyboard focus containment', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('aria-controls=\\"ys-widget-panel\\"');
    expect(snippet).toContain('role=\\"dialog\\" aria-labelledby=\\"ys-widget-title\\"');
    expect(snippet).toContain('role=\\"log\\" aria-label=\\"Chat messages\\" aria-live=\\"polite\\"');
    expect(snippet).toContain('aria-relevant=\\"additions\\"');
    expect(snippet).not.toContain('aria-relevant=\\"additions text\\"');
    expect(snippet).toContain('function _ysFocusableElements()');
    expect(snippet).toContain('function _ysFocusFirst()');
    expect(snippet).toContain('if(input&&!input.disabled){input.focus();return;}');
    expect(snippet).toContain('textarea,iframe,[tabindex]');
    expect(snippet).toContain('el.tabIndex!==-1');
    expect(snippet).toContain('if(e.key===\"Tab\"&&isOpen)');
    expect(snippet).toContain('shadow.activeElement');
    expect(snippet).toContain('messagesEl.setAttribute(\"aria-live\",show?\"off\":\"polite\")');
  });

  it('uses accessible typography, target sizes, focus, and motion defaults', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('--ys-focus-width:3px');
    expect(snippet).toContain('#ys-widget-root :focus-visible');
    expect(snippet).toContain('width:44px;height:44px');
    expect(snippet).toContain('.ys-msg{padding:11px 14px;border-radius:18px;font-size:16px;line-height:1.6');
    expect(snippet).toContain('@media (prefers-reduced-motion:reduce)');
  });

  it('includes an accessible, widget-scoped preference panel', () => {
    const snippet = buildWidgetSnippet({ agentId: 'agent-id', embedHandle: 'embed-token', apiBaseUrl: 'http://localhost:3000/api/v1' });

    expect(snippet).toContain('ys-widget-accessibility-btn');
    expect(snippet).toContain('ys-widget-accessibility-panel');
    expect(snippet).toContain('ys-setting-notifications');
    expect(snippet).toContain('ys-setting-language');
    expect(snippet).toContain('ys-setting-dark');
    expect(snippet).toContain('ys-setting-size');
    expect(snippet).toContain('ys-setting-tts');
    expect(snippet).toContain('ys_widget_preferences:"+(AGENT_ID||YS_EMBED_HANDLE)');
    expect(snippet).toContain('function applyWidgetPrefs()');
    expect(snippet).toContain('function setAccessibilityPanel(open)');
    expect(snippet).toContain('darkColors={background:"#111827"');
    expect(snippet).toContain('root.style.setProperty("--ys-panel-width","360px")');
    expect(snippet).toContain('widgetPrefs.language=settingLanguage.value;saveWidgetPrefs();applyWidgetPrefs()');
    expect(snippet).toContain('title:"Paramètres"');
    expect(snippet).toContain('languageOptions:{auto:"Navigateur",fr:"Français",en:"Anglais"}');
    expect(snippet).toContain('sizeOptions:{default:"Par défaut",compact:"Compact",large:"Grand",veryLarge:"Très grand"}');
    expect(snippet).toContain('value=\\"very-large\\">Very Large');
    expect(snippet).toContain('["default","compact","large","very-large"]');
    expect(snippet).toContain('root.style.setProperty("--ys-panel-width","720px")');
    expect(snippet).toContain('root.style.setProperty("--ys-panel-height","1080px")');
  });

  it('wires citation badges to signed URLs and PDF page fragments', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('_ysUpsertCitation');
    expect(snippet).toContain('_ysNextCitationRef');
    expect(snippet).toContain('_ysInjectCitationMarkers');
    expect(snippet).toContain('function _ysCitationSourceTitle(url)');
    expect(snippet).toContain('label=_ysCitationSourceTitle(url)||ref||name||url||"Source"');
    expect(snippet).toContain('function refreshCitationLabels()');
    expect(snippet).toContain('_ysSortCitations');
    expect(snippet).toContain('ys-comp-citation-badge');
    expect(snippet).toContain('data-ys-page');
    expect(snippet).toContain('data-ys-highlight');
    expect(snippet).toContain('ys-file-viewer-quote');
    expect(snippet).toContain('ys-file-viewer-quote-mark');
    expect(snippet).toContain('_ysBuildPdfPreviewUrl');
    expect(snippet).toContain('"page="');
    expect(snippet).toContain('"search="');
    expect(snippet).toContain('CITATION_URL_API_URL');
    expect(snippet).toContain('_ysStreamSessionId===SESSION_ID');
  });
});
