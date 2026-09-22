import { create } from 'zustand';
import { DEFAULT_FEATURE_VISIBILITY } from './constants';
import type { FeatureVisibility } from './types';

const STORAGE_KEY = 'yellowstorm-feature-visibility';

function normalize(value: unknown): FeatureVisibility {
  const stored = value && typeof value === 'object' ? value as Partial<FeatureVisibility> : {};
  return Object.fromEntries(Object.entries(DEFAULT_FEATURE_VISIBILITY).map(([key, fallback]) => [
    key,
    typeof stored[key as keyof FeatureVisibility] === 'boolean' ? stored[key as keyof FeatureVisibility] : fallback,
  ])) as unknown as FeatureVisibility;
}

function initialVisibility(): FeatureVisibility {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return DEFAULT_FEATURE_VISIBILITY;
  }
}

interface FeatureVisibilityState {
  visibility: FeatureVisibility;
  setVisibility: (visibility: FeatureVisibility) => void;
}

export const useFeatureVisibilityStore = create<FeatureVisibilityState>((set) => ({
  visibility: initialVisibility(),
  setVisibility: (visibility) => {
    const normalized = normalize(visibility);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Runtime state still works when storage is unavailable.
    }
    set({ visibility: normalized });
  },
}));
