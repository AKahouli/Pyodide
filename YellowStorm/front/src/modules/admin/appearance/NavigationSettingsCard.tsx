import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ListTree, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getNavigationSettings, updateNavigationSettings } from '../api';
import { DEFAULT_NAVIGATION_SETTINGS, NAVIGATION_TARGETS, sortNavigationNodes } from '../navigation';
import type { NavigationNode, NavigationSettings, NavigationTargetKey } from '../types';

function normalizePositions(nodes: NavigationNode[]): NavigationNode[] {
  const positions = new Map<string, number>();
  for (const parentId of new Set(nodes.map((node) => node.parentId))) {
    nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.position - b.position)
      .forEach((node, index) => positions.set(node.id, index));
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}

function flattenNodes(settings: NavigationSettings): Array<{ node: NavigationNode; depth: number }> {
  const rows: Array<{ node: NavigationNode; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const node of sortNavigationNodes(settings, parentId)) {
      rows.push({ node, depth });
      if (node.type === 'group') visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

function removeBranch(nodes: NavigationNode[], id: string): NavigationNode[] {
  const ids = new Set([id]);
  let previousSize = 0;
  while (previousSize !== ids.size) {
    previousSize = ids.size;
    for (const node of nodes) if (node.parentId && ids.has(node.parentId)) ids.add(node.id);
  }
  return normalizePositions(nodes.filter((node) => !ids.has(node.id)));
}

export function validParentGroups(nodes: NavigationNode[], node: NavigationNode): NavigationNode[] {
  const descendants = new Set<string>();
  const collect = (id: string) => nodes.filter((candidate) => candidate.parentId === id).forEach((child) => {
    descendants.add(child.id);
    collect(child.id);
  });
  collect(node.id);

  const depth = (id: string): number => {
    const current = nodes.find((candidate) => candidate.id === id);
    return current?.parentId ? depth(current.parentId) + 1 : 0;
  };
  const branchDepth = (id: string): number => Math.max(0, ...nodes
    .filter((candidate) => candidate.parentId === id)
    .map((child) => branchDepth(child.id) + 1));

  return nodes.filter((candidate) => candidate.type === 'group'
    && candidate.id !== node.id
    && !descendants.has(candidate.id)
    && depth(candidate.id) + 1 + branchDepth(node.id) <= 3);
}

export function NavigationSettingsCard() {
  const { t } = useModuleTranslation('admin');
  const [settings, setSettings] = useState<NavigationSettings>(DEFAULT_NAVIGATION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getNavigationSettings().then(setSettings)
      .catch(() => showError(t('appearance.navigation.loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  const rows = useMemo(() => flattenNodes(settings), [settings]);
  const usedTargets = new Set(settings.nodes.map((node) => node.targetKey).filter(Boolean));
  const availableTargets = (Object.keys(NAVIGATION_TARGETS) as NavigationTargetKey[])
    .filter((key) => !usedTargets.has(key));

  const changeNodes = (nodes: NavigationNode[]) => {
    setSettings((current) => ({ ...current, nodes: normalizePositions(nodes) }));
    setDirty(true);
  };

  const updateNode = (id: string, update: Partial<NavigationNode>) => {
    changeNodes(settings.nodes.map((node) => node.id === id ? { ...node, ...update } : node));
  };

  const addGroup = () => {
    changeNodes([...settings.nodes, {
      id: `group-${Date.now()}`,
      type: 'group',
      parentId: null,
      position: settings.nodes.filter((node) => node.parentId === null).length,
      visible: true,
      labels: { en: 'New submenu', fr: 'Nouveau sous-menu' },
    }]);
  };

  const addItem = () => {
    const targetKey = availableTargets[0];
    if (!targetKey) return;
    changeNodes([...settings.nodes, {
      id: `${targetKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${Date.now()}`,
      type: 'item',
      parentId: null,
      position: settings.nodes.filter((node) => node.parentId === null).length,
      visible: true,
      labels: { ...NAVIGATION_TARGETS[targetKey].defaultLabels },
      targetKey,
    }]);
  };

  const move = (node: NavigationNode, offset: -1 | 1) => {
    const siblings = sortNavigationNodes(settings, node.parentId);
    const other = siblings[siblings.findIndex((candidate) => candidate.id === node.id) + offset];
    if (!other) return;
    changeNodes(settings.nodes.map((candidate) => candidate.id === node.id
      ? { ...candidate, position: other.position }
      : candidate.id === other.id ? { ...candidate, position: node.position } : candidate));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updateNavigationSettings(settings);
      setSettings(saved);
      setDirty(false);
      window.dispatchEvent(new CustomEvent('navigation-settings-updated', { detail: saved }));
      showSuccess(t('appearance.navigation.saved'));
    } catch (error) {
      showError(parseApiError(error).message || t('appearance.navigation.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex items-start gap-3'>
          <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'><ListTree className='h-5 w-5' /></div>
          <div className='space-y-1'><CardTitle>{t('appearance.navigation.title')}</CardTitle><CardDescription>{t('appearance.navigation.description')}</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex flex-wrap gap-2'>
          <Button type='button' variant='outline' onClick={addGroup} disabled={loading}><Plus className='mr-2 h-4 w-4' />{t('appearance.navigation.addSubmenu')}</Button>
          <Button type='button' variant='outline' onClick={addItem} disabled={loading || availableTargets.length === 0}><Plus className='mr-2 h-4 w-4' />{t('appearance.navigation.addItem')}</Button>
          <Button type='button' variant='ghost' onClick={() => { setSettings(structuredClone(DEFAULT_NAVIGATION_SETTINGS)); setDirty(true); }} disabled={loading}><RotateCcw className='mr-2 h-4 w-4' />{t('appearance.navigation.reset')}</Button>
        </div>

        {loading ? <p className='text-sm text-muted-foreground'>{t('appearance.actions.loading')}</p> : (
          <div className='space-y-2' aria-label={t('appearance.navigation.tree')}>
            {rows.map(({ node, depth }) => {
              const siblings = sortNavigationNodes(settings, node.parentId);
              const siblingIndex = siblings.findIndex((item) => item.id === node.id);
              return (
                <div key={node.id} className='grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_11rem_auto]' style={{ marginLeft: `${Math.min(depth, 3) * 16}px` }}>
                  <div className='grid grid-cols-2 gap-2'>
                    <div><Label htmlFor={`${node.id}-en`}>EN</Label><Input id={`${node.id}-en`} value={node.labels.en} onChange={(event) => updateNode(node.id, { labels: { ...node.labels, en: event.target.value } })} /></div>
                    <div><Label htmlFor={`${node.id}-fr`}>FR</Label><Input id={`${node.id}-fr`} value={node.labels.fr} onChange={(event) => updateNode(node.id, { labels: { ...node.labels, fr: event.target.value } })} /></div>
                  </div>
                  <div>
                    <Label htmlFor={`${node.id}-parent`}>{t('appearance.navigation.parent')}</Label>
                    <select id={`${node.id}-parent`} className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={node.parentId ?? ''} onChange={(event) => updateNode(node.id, { parentId: event.target.value || null, position: settings.nodes.length })}>
                      <option value=''>{t('appearance.navigation.root')}</option>
                      {validParentGroups(settings.nodes, node).map((group) => <option key={group.id} value={group.id}>{group.labels.en}</option>)}
                    </select>
                  </div>
                  <div>
                    {node.type === 'item' ? <><Label htmlFor={`${node.id}-target`}>{t('appearance.navigation.target')}</Label><select id={`${node.id}-target`} className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={node.targetKey} onChange={(event) => updateNode(node.id, { targetKey: event.target.value as NavigationTargetKey })}>{(Object.keys(NAVIGATION_TARGETS) as NavigationTargetKey[]).filter((key) => key === node.targetKey || !usedTargets.has(key)).map((key) => <option key={key} value={key}>{NAVIGATION_TARGETS[key].defaultLabels.en}</option>)}</select></> : <p className='pt-6 text-sm text-muted-foreground'>{t('appearance.navigation.submenu')}</p>}
                  </div>
                  <div className='flex items-end gap-1'>
                    <label className='flex h-9 items-center gap-2 px-2 text-sm'><input type='checkbox' checked={node.visible} onChange={(event) => updateNode(node.id, { visible: event.target.checked })} />{t('appearance.navigation.visible')}</label>
                    <Button type='button' variant='ghost' size='icon' aria-label={t('appearance.navigation.moveUp', { name: node.labels.en })} disabled={siblingIndex === 0} onClick={() => move(node, -1)}><ArrowUp className='h-4 w-4' /></Button>
                    <Button type='button' variant='ghost' size='icon' aria-label={t('appearance.navigation.moveDown', { name: node.labels.en })} disabled={siblingIndex === siblings.length - 1} onClick={() => move(node, 1)}><ArrowDown className='h-4 w-4' /></Button>
                    <Button type='button' variant='ghost' size='icon' aria-label={t('appearance.navigation.remove', { name: node.labels.en })} onClick={() => changeNodes(removeBranch(settings.nodes, node.id))}><Trash2 className='h-4 w-4' /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className='flex justify-end'><Button type='button' onClick={() => void save()} disabled={!dirty || loading || saving}><Save className='mr-2 h-4 w-4' />{saving ? t('appearance.navigation.saving') : t('appearance.navigation.save')}</Button></div>
      </CardContent>
    </Card>
  );
}
