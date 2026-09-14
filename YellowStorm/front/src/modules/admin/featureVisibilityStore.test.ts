import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_VISIBILITY } from './constants';
import { useFeatureVisibilityStore } from './featureVisibilityStore';

describe('feature visibility store', () => {
  beforeEach(() => {
    localStorage.clear();
    useFeatureVisibilityStore.setState({ visibility: DEFAULT_FEATURE_VISIBILITY });
  });

  it('updates runtime settings and caches them for the next page load', () => {
    const visibility = { ...DEFAULT_FEATURE_VISIBILITY, playbookMcpAssistant: false };

    useFeatureVisibilityStore.getState().setVisibility(visibility);

    expect(useFeatureVisibilityStore.getState().visibility.playbookMcpAssistant).toBe(false);
    expect(JSON.parse(localStorage.getItem('yellowstorm-feature-visibility') ?? '{}')).toEqual(visibility);
  });
});
