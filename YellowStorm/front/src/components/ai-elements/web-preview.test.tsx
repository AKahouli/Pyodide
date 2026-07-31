import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WebPreview, WebPreviewBody, isolateGeneratedPreviewHtml } from './web-preview';

describe('generated web preview isolation', () => {
  it('injects a restrictive CSP at the start of an existing head', () => {
    const result = isolateGeneratedPreviewHtml('<html><head><title>Preview</title></head><body>OK</body></html>');

    expect(result).toContain('<head><meta http-equiv="Content-Security-Policy"');
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
  });

  it('wraps an HTML fragment in an isolated document', () => {
    const result = isolateGeneratedPreviewHtml('<main>Preview</main>');

    expect(result).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(result).toContain('<body><main>Preview</main></body>');
  });

  it('moves the CSP ahead of malformed executable markup', () => {
    const result = isolateGeneratedPreviewHtml('<script>window.location="https://example.com"</script><head><title>Late head</title></head>');

    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<script>'));
  });

  it('uses a unique-origin sandbox for generated content', () => {
    render(
      <WebPreview defaultUrl='blob:preview'>
        <WebPreviewBody isolation='generated' />
      </WebPreview>,
    );

    const frame = screen.getByTitle('Preview');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('preserves the compatibility sandbox for external previews', () => {
    render(
      <WebPreview defaultUrl='https://example.com'>
        <WebPreviewBody />
      </WebPreview>,
    );

    expect(screen.getByTitle('Preview')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation',
    );
  });
});
