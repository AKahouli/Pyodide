import { createElement, useEffect, useMemo, useState, useCallback, memo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { ProfileMenu } from '@/components/ui/profile-menu';
import { ModeToggle } from '@/components/mode-toggle';
import { AppBrandLogo } from '@/components/AppBrandLogo';
import {
  useConversationStore,
  useConversationsLoading,
  useHistoryConversations,
} from '@/modules/conversation/store';
import { useConversationV2PointersStore } from '@/modules/conversation-v2/store';
import {
  DEFAULT_FEATURE_VISIBILITY,
  getFeatureVisibility,
  NAVIGATION_TARGETS,
  navigationLabel,
  useNavigationSettings,
  visibleNavigationItems,
} from '@/modules/admin';
import type { FeatureVisibility } from '@/modules/admin';
import { useAdminAccess } from '@/modules/admin/hooks/useAdminAccess';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { useAuth } from '@/modules/auth';
import { isPendingAdminApproval } from '@/modules/auth/utils/isPendingAdminApproval';
import { useModuleTranslation } from '@/modules/localization';
import { GlobalSearch, type SearchDestination } from './GlobalSearch';
import { ManagedNavigation, NAVIGATION_TARGET_ICONS, navigationTargetAllowed } from './ManagedNavigation';
import { NavigationLauncher } from './NavigationLauncher';
import { useAutoCollapse } from '../hooks/useAutoCollapse';
import { buildHistoryRows, RECENT_CHATS_CAP } from './chatGroups';

export const AppSidebar = memo(function AppSidebar() {
  const { isMobile, state, setOpen, toggleSidebar } = useAutoCollapse();
  const navigate = useNavigate();
  const { t, language } = useModuleTranslation('sidebar');
  const { hasAnyPermission, canUseFeature, canSeeMenu } = usePermissions();
  const { hasAdminAccess } = useAdminAccess();
  const navigation = useNavigationSettings();
  const [featureVisibility, setFeatureVisibility] = useState<FeatureVisibility>(DEFAULT_FEATURE_VISIBILITY);
  const { user } = useAuth();
  const pendingApproval = isPendingAdminApproval(user);

  useEffect(() => {
    if (pendingApproval) return;
    let active = true;
    getFeatureVisibility()
      .then((value) => {
        if (active) setFeatureVisibility(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pendingApproval]);

  const historyConversations = useHistoryConversations();
  const conversationsLoading = useConversationsLoading();
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const v2Pointers = useConversationV2PointersStore((s) => s.items);
  const fetchV2Pointers = useConversationV2PointersStore((s) => s.fetch);

  useEffect(() => {
    // Load at least the rail cap so "All chats" is reachable whenever more exists.
    fetchConversations({ reset: true, limit: RECENT_CHATS_CAP });
    fetchV2Pointers({ reset: true });
  }, [fetchConversations, fetchV2Pointers]);

  const mergedHistory = useMemo(
    () => buildHistoryRows(historyConversations, v2Pointers, t('recentChats.untitled')),
    [historyConversations, v2Pointers, t],
  );
  const cappedRows = useMemo(() => mergedHistory.slice(0, RECENT_CHATS_CAP), [mergedHistory]);

  const handleNewConversation = useCallback(() => {
    if (!isMobile && state === 'collapsed') toggleSidebar();
    navigate('/');
  }, [isMobile, navigate, state, toggleSidebar]);

  const allowedNavigationItems = useMemo(() => {
    return visibleNavigationItems(navigation)
      .filter((node) => node.targetKey
        && navigationTargetAllowed(node.targetKey, { featureVisibility, canUseFeature, canSeeMenu, hasAnyPermission, hasAdminAccess }));
  }, [canSeeMenu, canUseFeature, featureVisibility, hasAdminAccess, hasAnyPermission, navigation]);

  const allowedLauncherItems = useMemo(() => {
    return visibleNavigationItems(navigation, 'launcher')
      .filter((node) => node.targetKey
        && navigationTargetAllowed(node.targetKey, { featureVisibility, canUseFeature, canSeeMenu, hasAnyPermission, hasAdminAccess }));
  }, [canSeeMenu, canUseFeature, featureVisibility, hasAdminAccess, hasAnyPermission, navigation]);

  const destinations = useMemo<SearchDestination[]>(() => {
    return allowedLauncherItems
      .filter((node) => !['newChat', 'projects'].includes(node.targetKey!))
      .map((node) => ({
        label: navigationLabel(node.labels, language),
        to: NAVIGATION_TARGETS[node.targetKey!].path,
        icon: createElement(NAVIGATION_TARGET_ICONS[node.targetKey!], { className: 'size-4' }),
      }));
  }, [allowedLauncherItems, language]);

  // One click anywhere on the collapsed rail re-opens it. setOpen(true) is
  // idempotent, so inner toggles (trigger, rail strip) never double-fire.
  const handleRailClick = useCallback(() => {
    if (!isMobile && state === 'collapsed') setOpen(true);
  }, [isMobile, state, setOpen]);

  return (
    <Sidebar collapsible='icon' className='shrink-0 z-30' onClick={handleRailClick}>
      {/* Header remains fixed while configured navigation controls every destination. */}
      <SidebarHeader className='gap-2 pt-8 duration-500 ease-linear group-data-[collapsible=icon]:pt-4'>
        <NavLink
          to='/'
          aria-label={t('actions.home')}
          className='mb-4 flex h-12 items-center overflow-hidden duration-500 ease-linear group-data-[collapsible=icon]:mb-0 group-data-[collapsible=icon]:h-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0'
        >
          <AppBrandLogo className='h-12 shrink-0' />
        </NavLink>
        <SidebarMenu>
          <SidebarMenuItem>
            <NavigationLauncher
              settings={navigation}
              items={allowedLauncherItems}
              language={language}
              mobile={isMobile}
              onNewConversation={handleNewConversation}
              label={t('launcher.label')}
            />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <GlobalSearch
              destinations={destinations}
              showChats={allowedNavigationItems.some((node) => node.targetKey === 'history')}
              showProjects={allowedNavigationItems.some((node) => node.targetKey === 'projects')}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className={`my-3 gap-0 overflow-hidden ${!isMobile && state === 'collapsed' ? '[&_[data-slot=collapsible-content]]:hidden' : ''}`}>
        <ManagedNavigation
          settings={navigation}
          language={language}
          featureVisibility={featureVisibility}
          canUseFeature={canUseFeature}
          canSeeMenu={canSeeMenu}
          hasAnyPermission={hasAnyPermission}
          hasAdminAccess={hasAdminAccess}
          onNewConversation={handleNewConversation}
          historyRows={cappedRows}
          historyLoading={conversationsLoading}
          showAllChatsLink
          collapsed={isMobile || state === 'collapsed'}
          navigateOnDisclosureClick={!isMobile && state === 'collapsed'}
        />
      </SidebarContent>

      <SidebarFooter className='gap-1 p-2'>
        {/* Above the SidebarRail hit-strip so the trigger stays clickable when collapsed. */}
        <div className={`relative z-30 mt-1 flex items-center gap-1 border-t border-sidebar-border pt-2 ${!isMobile && state === 'collapsed' ? 'flex-col' : ''}`}>
          <ProfileMenu />
          <span className='group-data-[collapsible=icon]:hidden'>
            <ModeToggle />
          </span>
          <SidebarTrigger />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
});
