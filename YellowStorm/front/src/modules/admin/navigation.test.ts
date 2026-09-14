import { describe, expect, it } from 'vitest';
import { DEFAULT_NAVIGATION_SETTINGS, visibleNavigationItems } from './navigation';

describe('visibleNavigationItems', () => {
  it('preserves managed order and excludes items under hidden ancestors', () => {
    const settings = structuredClone(DEFAULT_NAVIGATION_SETTINGS);
    settings.nodes.find((node) => node.id === 'knowledge')!.visible = false;
    settings.nodes.find((node) => node.id === 'govern')!.position = 0;
    settings.nodes.find((node) => node.id === 'work')!.position = 1;

    const targets = visibleNavigationItems(settings).map((node) => node.targetKey);
    expect(targets.slice(0, 2)).toEqual(['governance', 'admin']);
    expect(targets).not.toContain('workspace');
    expect(targets).not.toContain('semanticModels');
  });
});
