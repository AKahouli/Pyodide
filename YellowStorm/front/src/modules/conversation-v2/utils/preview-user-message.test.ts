import { describe, expect, it } from 'vitest';
import {
  looksTechnicalPreviewMessage,
  toUserFacingPreviewError,
} from './preview-user-message';

describe('preview-user-message', () => {
  it('flags env and runtime internals as technical', () => {
    expect(looksTechnicalPreviewMessage('Missing VITE_YM_APP_DATA_URL')).toBe(true);
    expect(looksTechnicalPreviewMessage('yellowruntime_preview_inspect failed')).toBe(true);
  });

  it('keeps short product-facing errors', () => {
    expect(looksTechnicalPreviewMessage('Could not reach the preview server.')).toBe(false);
  });

  it('replaces technical errors with the fallback', () => {
    expect(
      toUserFacingPreviewError('Missing VITE_YM_API_BASE_URL after restart', 'Something went wrong.'),
    ).toBe('Something went wrong.');
    expect(toUserFacingPreviewError('Preview timed out.', 'Something went wrong.')).toBe(
      'Preview timed out.',
    );
  });
});
