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
});
