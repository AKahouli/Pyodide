import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bot, Boxes, ChevronRight, History, Layers, LayoutGrid, MessageSquarePlus, Network, Plug, ShieldCheck, Sparkles, Users, Workflow,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { FeatureVisibility, NavigationNode, NavigationSettings, NavigationTargetKey } from '@/modules/admin';
import { NAVIGATION_TARGETS, navigationLabel, sortNavigationNodes, visibleNavigationItems } from '@/modules/admin';
import { ProjectsSection } from './ProjectsSection';
import { WorkspaceButton } from '@/modules/workspace';
import { SemanticModelButton } from '@/modules/semantic-model/components/SemanticModelButton';
import { PlaybookButton } from '@/modules/playbook/components/PlaybookButton';
import { WorkyButton } from '@/modules/worky/components/WorkyButton';
import { RecentChats } from './RecentChats';
import type { HistoryRow } from './chatGroups';

export const NAVIGATION_TARGET_ICONS: Record<NavigationTargetKey, React.ElementType> = {
  platform: LayoutGrid,
  newChat: MessageSquarePlus,
  projects: Boxes,
  history: History,
  workspace: Layers,
  semanticModels: Network,
  playbook: Workflow,
  agents: Bot,
  teams: Users,
  groups: Network,
  worky: Sparkles,
  connectedApps: Plug,
  appMarketplace: Boxes,
  governance: ShieldCheck,
  admin: ShieldCheck,
};

interface ManagedNavigationProps {
  settings: NavigationSettings;
  language: string;
  featureVisibility: FeatureVisibility;
  canUseFeature: (feature: keyof FeatureVisibility) => boolean;
  canSeeMenu: (menu: NavigationTargetKey) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAdminAccess: boolean;
  onNewConversation: () => void;
  historyRows: HistoryRow[];
  historyLoading: boolean;
  showAllChatsLink: boolean;
  collapsed: boolean;
  hideHistory?: boolean;
  hideNewChat?: boolean;
}

export function ManagedNavigation(props: ManagedNavigationProps) {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = navRef.current;
      const matches = nav?.querySelectorAll<HTMLElement>('[data-active="true"]');
      const active = matches?.[matches.length - 1];
      if (!nav || !active) return;
      const bounds = nav.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.top < bounds.top) nav.scrollTop -= bounds.top - item.top;
      else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, props.collapsed, props.settings, props.featureVisibility]);
  const roots = sortNavigationNodes(props.settings, null);
  const historyNode = visibleNavigationItems(props.settings)
    .find((node) => node.targetKey === 'history' && navigationTargetAllowed('history', props));
  return (
    <nav ref={navRef} className='flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto'>
      {roots.map((node) => <RootNode key={node.id} node={node} {...props} hideNewChat hideHistory={!props.collapsed} />)}
      {!props.collapsed && historyNode && <RootNode node={historyNode} {...props} hideNewChat />}
    </nav>
  );
}

export function navigationTargetAllowed(target: NavigationTargetKey, props: Pick<ManagedNavigationProps, 'featureVisibility' | 'canUseFeature' | 'canSeeMenu' | 'hasAnyPermission' | 'hasAdminAccess'>): boolean {
  if (!props.canSeeMenu(target)) return false;
  const feature = NAVIGATION_TARGETS[target].feature;
  if (feature && (!props.featureVisibility[feature] || !props.canUseFeature(feature))) return false;
  if (target === 'semanticModels' && !props.hasAnyPermission(['semantic_models.read', 'semantic_models.*', '*'])) return false;
  if (target === 'governance' && !props.hasAnyPermission(['governance.read', 'governance.*', '*'])) return false;
  if (target === 'admin' && !props.hasAdminAccess) return false;
  return true;
}

function hasContent(node: NavigationNode, props: ManagedNavigationProps): boolean {
  if (!node.visible) return false;
  if (props.hideHistory && node.targetKey === 'history') return false;
  if (props.hideNewChat && node.targetKey === 'newChat') return false;
  if (node.type === 'item') return Boolean(node.targetKey && navigationTargetAllowed(node.targetKey, props));
  return sortNavigationNodes(props.settings, node.id).some((child) => hasContent(child, props));
}

function RootNode({ node, ...props }: { node: NavigationNode } & ManagedNavigationProps) {
  if (!hasContent(node, props)) return null;
  if (node.type === 'item') {
    return <SidebarGroup className='shrink-0 py-1'><SidebarMenu><TreeNode node={node} {...props} /></SidebarMenu></SidebarGroup>;
  }
  return (
    <SidebarGroup className='shrink-0 py-1'>
      <SidebarGroupLabel>{navigationLabel(node.labels, props.language)}</SidebarGroupLabel>
      <SidebarMenu>{sortNavigationNodes(props.settings, node.id).map((child) => <TreeNode key={child.id} node={child} {...props} />)}</SidebarMenu>
    </SidebarGroup>
  );
}

function nodeIsActive(node: NavigationNode, props: ManagedNavigationProps, pathname: string): boolean {
  if (!hasContent(node, props)) return false;
  if (node.type === 'group') return sortNavigationNodes(props.settings, node.id).some((child) => nodeIsActive(child, props, pathname));
  if (!node.targetKey) return false;
  const path = NAVIGATION_TARGETS[node.targetKey].path;
  if (node.targetKey === 'projects') return /^\/projet(?:\/|$)/.test(pathname);
  return pathname === path || (path !== '/' && pathname.startsWith(`${path}/`));
}

function TreeNode({ node, ...props }: { node: NavigationNode } & ManagedNavigationProps) {
  const location = useLocation();
  const active = nodeIsActive(node, props, location.pathname);
  const [open, setOpen] = useState(node.targetKey === 'history' || active);
  useEffect(() => { if (active) setOpen(true); }, [active, location.pathname]);
  if (!hasContent(node, props)) return null;

  const label = navigationLabel(node.labels, props.language);
  if (node.type === 'group') {
    const children = sortNavigationNodes(props.settings, node.id).map((child) => <TreeNode key={child.id} node={child} {...props} collapsed={false} />);
    if (props.collapsed) return <CollapsedGroup label={label} active={active}>{children}</CollapsedGroup>;
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild><SidebarMenuButton tooltip={label} isActive={active}><Network /><span>{label}</span><ChevronRight className={cn('ml-auto size-4 transition-transform', open && 'rotate-90')} /></SidebarMenuButton></CollapsibleTrigger>
        </SidebarMenuItem>
        <CollapsibleContent className='pl-3'><SidebarMenu className='border-l border-sidebar-border pl-1.5'>{children}</SidebarMenu></CollapsibleContent>
      </Collapsible>
    );
  }

  if (!node.targetKey || !navigationTargetAllowed(node.targetKey, props)) return null;
  if (node.targetKey === 'newChat') {
    return <SidebarMenuItem><SidebarMenuButton tooltip={label} onClick={props.onNewConversation}><MessageSquarePlus /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
  }
  if (node.targetKey === 'history') {
    if (props.collapsed) return <SidebarMenuItem><SidebarMenuButton asChild tooltip={label} isActive={active}><NavLink to={NAVIGATION_TARGETS.history.path}><History /><span>{label}</span></NavLink></SidebarMenuButton></SidebarMenuItem>;
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <SidebarMenuItem><CollapsibleTrigger asChild><SidebarMenuButton tooltip={label} isActive={active}><History /><span>{label}</span><ChevronRight className={cn('ml-auto size-4 transition-transform', open && 'rotate-90')} /></SidebarMenuButton></CollapsibleTrigger></SidebarMenuItem>
        <CollapsibleContent className='pl-2'><RecentChats rows={props.historyRows} loading={props.historyLoading} showAllChatsLink={props.showAllChatsLink} compact /></CollapsibleContent>
      </Collapsible>
    );
  }
  if (node.targetKey === 'projects') return <ProjectsSection label={label} flyout={props.collapsed} />;
  if (node.targetKey === 'workspace') return <WorkspaceButton label={label} />;
  if (node.targetKey === 'semanticModels') return <SemanticModelButton label={label} />;
  if (node.targetKey === 'playbook') return <PlaybookButton label={label} />;
  if (node.targetKey === 'worky') return <WorkyButton label={label} />;
  const to = NAVIGATION_TARGETS[node.targetKey].path;
  const Icon = NAVIGATION_TARGET_ICONS[node.targetKey];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={label} isActive={location.pathname === to || (to !== '/' && location.pathname.startsWith(to))}>
        <NavLink to={to}><Icon /><span>{label}</span></NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function CollapsedGroup({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  return <SidebarMenuItem><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><SidebarMenuButton tooltip={label} isActive={active}><Network /><span>{label}</span></SidebarMenuButton></PopoverTrigger>
    <PopoverContent side='right' align='start' sideOffset={8} aria-label={label} className='max-h-[calc(100dvh-2rem)] w-60 overflow-y-auto p-2' onClick={(event) => {
      if ((event.target as HTMLElement).closest('a[href]')) setOpen(false);
    }}>
      <h2 className='mb-2 px-2 text-sm font-semibold'>{label}</h2>
      <SidebarMenu>{children}</SidebarMenu>
    </PopoverContent>
  </Popover></SidebarMenuItem>;
}
