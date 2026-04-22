/**
 * AdminDashboard - Admin home page with feature cards
 */

import { NavLink } from 'react-router-dom';
import { Palette } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useAdminAccess } from '../hooks';

export function AdminDashboard() {
  const { accessibleMenuItems } = useAdminAccess();
  const { t } = useModuleTranslation('admin');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('dashboard.description')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NavLink to="/admin/appearance" className="group rounded-lg border p-4 hover:border-primary transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
              <Palette className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div>
              <h3 className="font-medium">{t('appearance.title')}</h3>
              <p className="text-sm text-muted-foreground">{t('appearance.description')}</p>
            </div>
          </div>
        </NavLink>

        {accessibleMenuItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className="group rounded-lg border p-4 hover:border-primary transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
                <item.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div>
                <h3 className="font-medium">{t(item.labelKey)}</h3>
                <p className="text-sm text-muted-foreground">{t(item.descriptionKey)}</p>
              </div>
            </div>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
