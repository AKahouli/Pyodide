import { describe, expect, it } from 'vitest';
import {
  extractNodepodPortFromPreviewUrl,
  extractPortFromDevServerOutput,
  resolvePreviewPort,
} from './useNodepodPreview';
import { createRuntimeKey } from '../services/nodepod-runtime-registry';

describe('useNodepodPreview port resolution helpers', () => {
  it('extracts the internal port from a Nodepod virtual URL', () => {
    expect(
      extractNodepodPortFromPreviewUrl(
        'https://poc.yellowmind.ai/__virtual__/podb174ceb4/3000',
      ),
    ).toBe(3000);
  });

  it('extracts the localhost port from dev-server output with ANSI codes', () => {
    expect(
      extractPortFromDevServerOutput(
        '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m3000\u001b[22m/\u001b[39m',
      ),
    ).toBe(3000);
  });

  it('prefers the preview URL port over the reported fallback port', () => {
    expect(
      resolvePreviewPort({
        previewUrl: 'https://poc.yellowmind.ai/__virtual__/podb174ceb4/3000',
        reportedPort: 5173,
      }),
    ).toBe(3000);
  });

  it('builds a runtime key from session and revision', () => {
    expect(createRuntimeKey('session-1', 'rev-2')).toBe('session-1:rev-2');
  });
});
