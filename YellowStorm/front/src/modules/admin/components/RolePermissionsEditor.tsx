import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';
import { FEATURE_PERMISSION_ITEMS, MENU_PERMISSION_ITEMS } from '../constants';
import { PERMISSION_GROUPS } from '../types';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;
type VisibilityNamespace = 'feature' | 'menu';

export function toggleScopedPermission(
  permissions: string[],
  namespace: VisibilityNamespace,
  available: readonly string[],
  target: string,
): string[] {
  const prefix = `${namespace}.`;
  const scoped = permissions.filter((permission) => permission.startsWith(prefix));
  const unscoped = permissions.filter((permission) => !permission.startsWith(prefix));

  if (scoped.length === 0) {
    return [...unscoped, `${namespace}.restricted`, ...available.filter((permission) => permission !== target)];
  }

  const selected = new Set(scoped.filter((permission) => permission !== `${namespace}.restricted`));
  if (selected.has(target)) selected.delete(target);
  else selected.add(target);

  if (available.every((permission) => selected.has(permission))) return unscoped;
  return [...unscoped, `${namespace}.restricted`, ...selected];
}

export function isScopedPermissionSelected(permissions: string[], namespace: VisibilityNamespace, permission: string) {
  if (permissions.includes('*')) return true;
  const scoped = permissions.some((candidate) => candidate.startsWith(`${namespace}.`));
  return !scoped || permissions.includes(permission);
}

export function countSelectedRolePermissions(permissions: string[]) {
  const adminCount = permissions.filter((permission) => !permission.startsWith('feature.') && !permission.startsWith('menu.')).length;
  const featureCount = FEATURE_PERMISSION_ITEMS.filter((item) => isScopedPermissionSelected(permissions, 'feature', item.permission)).length;
  const menuCount = MENU_PERMISSION_ITEMS.filter((item) => isScopedPermissionSelected(permissions, 'menu', item.permission)).length;
  return adminCount + featureCount + menuCount;
}

interface RolePermissionsEditorProps {
  permissions: string[];
  expandedGroups: Set<string>;
  onToggleGroup: (namespace: string) => void;
  onTogglePermission: (permission: string) => void;
  onToggleAllInGroup: (namespace: string, permissions: string[]) => void;
  onChange: (permissions: string[]) => void;
  t: AdminTranslate;
}

export function RolePermissionsEditor({
  permissions,
  expandedGroups,
  onToggleGroup,
  onTogglePermission,
  onToggleAllInGroup,
  onChange,
  t,
}: RolePermissionsEditorProps) {
  const featurePermissions = FEATURE_PERMISSION_ITEMS.map((item) => item.permission);
  const menuPermissions = MENU_PERMISSION_ITEMS.map((item) => item.permission);

  return (
    <Tabs defaultValue="admin" className="min-w-0">
      <TabsList className="grid h-auto w-full grid-cols-3">
        <TabsTrigger value="admin" className="whitespace-normal">{t('roles.permissions.tabs.admin')}</TabsTrigger>
        <TabsTrigger value="features" className="whitespace-normal">{t('roles.permissions.tabs.features')}</TabsTrigger>
        <TabsTrigger value="menus" className="whitespace-normal">{t('roles.permissions.tabs.menus')}</TabsTrigger>
      </TabsList>

      <TabsContent value="admin" className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border p-4">
        {PERMISSION_GROUPS.map((group) => {
          const groupPermissions = group.permissions.map((permission) => permission.value);
          const selectedCount = groupPermissions.filter((permission) => permissions.includes(permission)).length;
          const allSelected = selectedCount === groupPermissions.length;
          const someSelected = selectedCount > 0 && !allSelected;

          return (
            <Collapsible key={group.namespace} open={expandedGroups.has(group.namespace)} onOpenChange={() => onToggleGroup(group.namespace)} disabled={group.disabled}>
              <div className="flex items-center gap-2 py-1">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    {expandedGroups.has(group.namespace) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <Checkbox
                  id={`group-${group.namespace}`}
                  checked={someSelected ? 'indeterminate' : allSelected}
                  onCheckedChange={() => onToggleAllInGroup(group.namespace, groupPermissions)}
                />
                <Label htmlFor={`group-${group.namespace}`} className="flex-1 cursor-pointer font-medium">{t(group.labelKey)}</Label>
                {selectedCount > 0 && <Badge variant="secondary" className="text-xs">{selectedCount}</Badge>}
              </div>
              <CollapsibleContent className="space-y-1 pl-10 pt-1">
                {group.permissions.map((permission) => (
                  <div key={permission.value} className="flex items-start gap-2 py-1">
                    <Checkbox id={`perm-${permission.value}`} checked={permissions.includes(permission.value)} onCheckedChange={() => onTogglePermission(permission.value)} />
                    <div className="flex-1">
                      <Label htmlFor={`perm-${permission.value}`} className="cursor-pointer text-sm">{t(permission.labelKey)}</Label>
                      <p className="text-xs text-muted-foreground">{t(permission.descriptionKey)}</p>
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </TabsContent>

      <TabsContent value="features" className="mt-2 max-h-64 overflow-y-auto rounded-lg border">
        <p className="border-b p-3 text-xs text-muted-foreground">{t('roles.permissions.featureHelp')}</p>
        {FEATURE_PERMISSION_ITEMS.map((item) => (
          <div key={item.key} className="flex items-start gap-3 border-b p-3 last:border-b-0">
            <Checkbox
              id={`role-${item.permission}`}
              checked={isScopedPermissionSelected(permissions, 'feature', item.permission)}
              disabled={permissions.includes('*')}
              onCheckedChange={() => onChange(toggleScopedPermission(permissions, 'feature', featurePermissions, item.permission))}
            />
            <div>
              <Label htmlFor={`role-${item.permission}`} className="cursor-pointer text-sm">{t(item.labelKey)}</Label>
              <p className="text-xs text-muted-foreground">{t(item.descriptionKey)}</p>
            </div>
          </div>
        ))}
      </TabsContent>

      <TabsContent value="menus" className="mt-2 max-h-64 overflow-y-auto rounded-lg border">
        <p className="border-b p-3 text-xs text-muted-foreground">{t('roles.permissions.menuHelp')}</p>
        {MENU_PERMISSION_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center gap-3 border-b p-3 last:border-b-0">
            <Checkbox
              id={`role-${item.permission}`}
              checked={isScopedPermissionSelected(permissions, 'menu', item.permission)}
              disabled={permissions.includes('*')}
              onCheckedChange={() => onChange(toggleScopedPermission(permissions, 'menu', menuPermissions, item.permission))}
            />
            <Label htmlFor={`role-${item.permission}`} className="cursor-pointer text-sm">{t(item.labelKey)}</Label>
          </div>
        ))}
      </TabsContent>
    </Tabs>
  );
}
