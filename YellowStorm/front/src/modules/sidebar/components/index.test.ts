import { describe, expect, it } from 'vitest';
import * as sidebarComponents from './index';

describe('sidebar components index exports', () => {
  it('exports AppSidebar and ConversationItem', () => {
    expect(sidebarComponents.AppSidebar).toBeDefined();
    expect(sidebarComponents.ConversationItem).toBeDefined();
  });
});
