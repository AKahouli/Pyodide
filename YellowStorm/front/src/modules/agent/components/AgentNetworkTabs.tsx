import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';

const TABS = [
  { to: '/agents', key: 'tabs.agents', menu: 'agents' },
  { to: '/teams', key: 'tabs.teams', menu: 'teams' },
  { to: '/groups', key: 'tabs.groups', menu: 'groups' },
] as const;

/** Depth-2 rule: the Agent Network sub-pages render as tabs inside each other's pages. */
export function AgentNetworkTabs() {
  const { t } = useModuleTranslation('agent');
  const { canSeeMenu } = usePermissions();
  const visible = TABS.filter((tab) => canSeeMenu(tab.menu));
  if (visible.length < 2) return null;

  return (
    <nav aria-label={t('tabs.label')} className='flex items-center gap-1'>
      {visible.map(({ to, key }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
              isActive && 'bg-accent font-medium text-accent-foreground',
            )
          }
        >
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );
}
