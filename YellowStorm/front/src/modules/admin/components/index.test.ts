import { describe, expect, it } from 'vitest';
import * as adminComponents from './index';

describe('admin components index', () => {
  it('exports all admin shell components', () => {
    expect(adminComponents.AdminGuard).toBeDefined();
    expect(adminComponents.AdminLayout).toBeDefined();
    expect(adminComponents.AdminSidebar).toBeDefined();
    expect(adminComponents.AdminButton).toBeDefined();
    expect(adminComponents.AdminDashboard).toBeDefined();
  });
});
