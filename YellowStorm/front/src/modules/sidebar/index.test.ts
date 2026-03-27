import { describe, expect, it } from 'vitest';
import * as sidebarModule from './index';

describe('sidebar module index exports', () => {
  it('exports components and hook', () => {
    expect(sidebarModule.AppSidebar).toBeDefined();
    expect(sidebarModule.ConversationItem).toBeDefined();
    expect(sidebarModule.useAutoCollapse).toBeDefined();
  });
});
