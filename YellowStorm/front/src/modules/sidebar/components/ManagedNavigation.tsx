import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bot, Boxes, ChevronRight, History, Layers, LayoutGrid, MessageSquarePlus, Network, Plug, ShieldCheck, Sparkles, Users, Workflow,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
}

export function ManagedNavigation(props: ManagedNavigationProps) {
  const roots = sortNavigationNodes(props.settings, null);
  const historyNode = visibleNavigationItems(props.settings)
    .find((node) => node.targetKey === 'history' && navigationTargetAllowed('history', props));
  if (props.collapsed || !historyNode) {
    return <nav className='flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto'>{roots.map((node) => <RootNode key={node.id} node={node} {...props} />)}</nav>;
  }
  return (
    <nav className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='max-h-[65%] shrink-0 overflow-y-auto'>{roots.map((node) => <RootNode key={node.id} node={node} {...props} hideHistory />)}</div>
      <RootNode node={historyNode} {...props} />
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
  if (node.type === 'item') return Boolean(node.targetKey && navigationTargetAllowed(node.targetKey, props));
  return sortNavigationNodes(props.settings, node.id).some((child) => hasContent(child, props));
}

function RootNode({ node, ...props }: { node: NavigationNode } & ManagedNavigationProps) {
  if (!hasContent(node, props)) return null;
  if (node.type === 'item') {
    const isHistory = node.targetKey === 'history';
    return <SidebarGroup className={isHistory ? 'min-h-0 flex-1' : 'shrink-0'}><SidebarMenu className={isHistory ? 'min-h-0 flex-1' : undefined}><TreeNode node={node} {...props} /></SidebarMenu></SidebarGroup>;
  }
  return (
    <SidebarGroup className='shrink-0 py-1'>
      <SidebarGroupLabel>{navigationLabel(node.labels, props.language)}</SidebarGroupLabel>
      <SidebarMenu>{sortNavigationNodes(props.settings, node.id).map((child) => <TreeNode key={child.id} node={child} {...props} />)}</SidebarMenu>
    </SidebarGroup>
  );
}

function TreeNode({ node, ...props }: { node: NavigationNode } & ManagedNavigationProps) {
  const location = useLocation();
  const storageKey = node.id === 'knowledge' ? 'sidebar:knowledgeOpen' : `sidebar:navigation:${node.id}:open`;
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return node.targetKey === 'history';
    const stored = localStorage.getItem(storageKey);
    return stored === null ? node.targetKey === 'history' : stored === 'true';
  });
  useEffect(() => {
    if (node.type === 'group' || node.targetKey === 'history') localStorage.setItem(storageKey, String(open));
  }, [node.targetKey, node.type, open, storageKey]);
  if (!hasContent(node, props)) return null;

  const label = navigationLabel(node.labels, props.language);
  if (node.type === 'group') {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild><SidebarMenuButton tooltip={label}><Network /><span>{label}</span><ChevronRight className={cn('ml-auto size-4 transition-transform', open && 'rotate-90')} /></SidebarMenuButton></CollapsibleTrigger>
        </SidebarMenuItem>
        <CollapsibleContent><SidebarMenu className='ml-4 border-l border-sidebar-border pl-1.5'>{sortNavigationNodes(props.settings, node.id).map((child) => <TreeNode key={child.id} node={child} {...props} />)}</SidebarMenu></CollapsibleContent>
      </Collapsible>
    );
  }

  if (!node.targetKey || !navigationTargetAllowed(node.targetKey, props)) return null;
  if (node.targetKey === 'newChat') {
    return <SidebarMenuItem><SidebarMenuButton tooltip={label} onClick={props.onNewConversation}><MessageSquarePlus /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>;
  }
  if (node.targetKey === 'history') {
    return (
      <Collapsible open={open} onOpenChange={setOpen} className='flex min-h-0 flex-1 flex-col'>
        <SidebarMenuItem className='shrink-0'><CollapsibleTrigger asChild><SidebarMenuButton tooltip={label}><History /><span>{label}</span><ChevronRight className={cn('ml-auto size-4 transition-transform', open && 'rotate-90')} /></SidebarMenuButton></CollapsibleTrigger></SidebarMenuItem>
        <CollapsibleContent className='min-h-0 flex-1 overflow-y-auto pl-2'><RecentChats rows={props.historyRows} loading={props.historyLoading} showAllChatsLink={props.showAllChatsLink} /></CollapsibleContent>
      </Collapsible>
    );
  }
  if (node.targetKey === 'projects') return <ProjectsSection label={label} />;
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
