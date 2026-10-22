import { describe, expect, it } from 'vitest';
import { DEFAULT_NAVIGATION_SETTINGS, ensureEvaluationTarget, visibleNavigationItems } from './navigation';

describe('visibleNavigationItems', () => {
  it('preserves managed order and excludes items under hidden ancestors', () => {
    const settings = structuredClone(DEFAULT_NAVIGATION_SETTINGS);
    settings.nodes.find((node) => node.id === 'knowledge')!.visible = false;
    settings.nodes.find((node) => node.id === 'govern')!.position = 0;
    settings.nodes.find((node) => node.id === 'work')!.position = 1;

    const targets = visibleNavigationItems(settings).map((node) => node.targetKey);
    expect(targets.slice(0, 3)).toEqual(['governance', 'evaluationLogicalSearch', 'admin']);
    expect(targets).not.toContain('workspace');
    expect(targets).not.toContain('semanticModels');
  });

  it('applies launcher visibility independently from sidebar visibility', () => {
    const settings = structuredClone(DEFAULT_NAVIGATION_SETTINGS);
    settings.nodes.find((node) => node.id === 'knowledge')!.visible = false;

    expect(visibleNavigationItems(settings, 'launcher').map((node) => node.targetKey)).toContain('workspace');
    settings.nodes.find((node) => node.id === 'knowledge')!.launcherVisible = false;
    expect(visibleNavigationItems(settings, 'launcher').map((node) => node.targetKey)).not.toContain('workspace');
  });
});

describe('ensureEvaluationTarget', () => {
  it('returns the same settings when the evaluation target already exists', () => {
    const settings = structuredClone(DEFAULT_NAVIGATION_SETTINGS);
    expect(ensureEvaluationTarget(settings)).toBe(settings);
  });

  it('injects the evaluation entry right after governance in the govern group', () => {
    const settings = structuredClone(DEFAULT_NAVIGATION_SETTINGS);
    settings.nodes = settings.nodes.filter((node) => node.targetKey !== 'evaluationLogicalSearch');

    const populated = ensureEvaluationTarget(settings);
    const governChildren = populated.nodes
      .filter((node) => node.parentId === 'govern')
      .sort((left, right) => left.position - right.position)
      .map((node) => node.targetKey);

    expect(governChildren).toEqual(['governance', 'evaluationLogicalSearch', 'admin']);
  });
});
