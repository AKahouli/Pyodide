import { describe, expect, it } from 'vitest';
import { buildWidgetSnippet } from './widget-template';

describe('buildWidgetSnippet', () => {
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
    expect(snippet).toContain('@media (max-width:480px)');
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

  it('wires citation badges to signed URLs and PDF page fragments', () => {
    const snippet = buildWidgetSnippet({
      agentId: 'agent-id',
      embedHandle: 'embed-token',
      apiBaseUrl: 'http://localhost:3000/api/v1',
    });

    expect(snippet).toContain('_ysUpsertCitation');
    expect(snippet).toContain('_ysNextCitationRef');
    expect(snippet).toContain('_ysInjectCitationMarkers');
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
