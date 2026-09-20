// P1.10/P1.14: four business working views over the existing editor modes.
// ponytail: maps to current tabs; no page rewrite. Unavailable views explain
// their prerequisite instead of showing misleading empty success.
import type { EditorMode } from '../types';

export type BusinessView = 'model' | 'sources' | 'data' | 'test';

export const BUSINESS_VIEWS: BusinessView[] = ['model', 'sources', 'data', 'test'];

export const VIEW_TO_MODE: Record<BusinessView, EditorMode> = {
  model: 'structure',
  sources: 'mappings',
  data: 'records',
  // Test reuses the published runtime (P8); until then it pins to structure read-only.
  test: 'structure',
};

export interface ViewPrerequisite {
  met: boolean;
  reason: string;
}

export function viewPrerequisite(
  view: BusinessView,
  flags: { hasConcepts: boolean; hasSources: boolean; hasData: boolean },
): ViewPrerequisite {
  switch (view) {
    case 'model':
      return { met: true, reason: '' };
    case 'sources':
      return flags.hasConcepts
        ? { met: true, reason: '' }
        : { met: false, reason: 'Define at least one business concept first.' };
    case 'data':
      return flags.hasSources
        ? { met: true, reason: '' }
        : { met: false, reason: 'Connect and prepare a source before viewing data.' };
    case 'test':
      return flags.hasData
        ? { met: true, reason: '' }
        : { met: false, reason: 'Publish or prepare data before testing questions.' };
  }
}

// P1.14 guided checklist (onboarding, not a locked wizard).
export const FIRST_TIME_CHECKLIST = [
  'Define',
  'Connect sources',
  'Prepare and review',
  'Test',
  'Publish',
] as const;
