import type { ModuleTranslationKey } from '@/modules/localization/types';
import type { AppBuildPhase } from '../interfaces/application';

export const APP_BUILD_PHASE_ORDER: AppBuildPhase[] = [
  'generation_started',
  'creating_files',
  'coding_complete',
  'installing_dependencies',
  'building_project',
  'waiting_for_build',
  'validating_preview',
  'fetching_app_code',
  'fetching_app_preview',
  'ready',
  'failed',
];

const BUILD_PHASE_TRANSLATION_KEYS = {
  generation_started: 'nodepod.buildPhase.generation_started',
  creating_files: 'nodepod.buildPhase.creating_files',
  coding_complete: 'nodepod.buildPhase.coding_complete',
  installing_dependencies: 'nodepod.buildPhase.installing_dependencies',
  building_project: 'nodepod.buildPhase.building_project',
  waiting_for_build: 'nodepod.buildPhase.waiting_for_build',
  validating_preview: 'nodepod.buildPhase.validating_preview',
  fetching_app_code: 'nodepod.buildPhase.fetching_app_code',
  fetching_app_preview: 'nodepod.buildPhase.fetching_app_preview',
  ready: 'nodepod.buildPhase.ready',
} as const satisfies Record<Exclude<AppBuildPhase, 'failed'>, ModuleTranslationKey<'conversation-v2'>>;

export function phaseIndex(phase: string): number {
  const idx = APP_BUILD_PHASE_ORDER.indexOf(phase as AppBuildPhase);
  return idx >= 0 ? idx : 0;
}

export function isFailedBuildPhase(phase: string): boolean {
  return phase === 'failed';
}

export function isReadyBuildPhase(phase: string): boolean {
  return phase === 'ready';
}

export function buildPhaseTranslationKey(phase: string): ModuleTranslationKey<'conversation-v2'> {
  return (
    BUILD_PHASE_TRANSLATION_KEYS[phase as Exclude<AppBuildPhase, 'failed'>] ??
    'nodepod.buildPhase.generation_started'
  );
}
