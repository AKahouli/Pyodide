import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, ListTree, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
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

export function moveBefore(nodes: NavigationNode[], draggedId: string, targetId: string): NavigationNode[] {
  if (draggedId === targetId) return nodes;
  const dragged = nodes.find((node) => node.id === draggedId);
  const target = nodes.find((node) => node.id === targetId);
  if (!dragged || !target) return nodes;
  if (target.parentId && !validParentGroups(nodes, dragged).some((group) => group.id === target.parentId)) return nodes;
  return normalizePositions([
    ...nodes.filter((node) => node.id !== draggedId),
    { ...dragged, parentId: target.parentId, position: target.position - 0.5 },
  ]);
}

export function NavigationSettingsCard() {
  const { t } = useModuleTranslation('admin');
  const [settings, setSettings] = useState<NavigationSettings>(DEFAULT_NAVIGATION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

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
    const id = `group-${Date.now()}`;
    changeNodes([...settings.nodes, {
      id,
      type: 'group',
      parentId: null,
      position: settings.nodes.filter((node) => node.parentId === null).length,
      visible: true,
      launcherVisible: true,
      labels: { en: 'New submenu', fr: 'Nouveau sous-menu' },
    }]);
    setExpandedId(id);
  };

  const addItem = () => {
    const targetKey = availableTargets[0];
    if (!targetKey) return;
    const id = `${targetKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${Date.now()}`;
    changeNodes([...settings.nodes, {
      id,
      type: 'item',
      parentId: null,
      position: settings.nodes.filter((node) => node.parentId === null).length,
      visible: true,
      launcherVisible: true,
      labels: { ...NAVIGATION_TARGETS[targetKey].defaultLabels },
      targetKey,
    }]);
    setExpandedId(id);
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
    <Card className='overflow-hidden'>
      <CardHeader className='border-b bg-muted/20'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='flex items-start gap-3'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'><ListTree className='h-5 w-5' /></div>
            <div className='space-y-1'><CardTitle>{t('appearance.navigation.title')}</CardTitle><CardDescription>{t('appearance.navigation.description')}</CardDescription></div>
          </div>
          <Button type='button' onClick={() => void save()} disabled={!dirty || loading || saving}><Save className='mr-2 h-4 w-4' />{saving ? t('appearance.navigation.saving') : t('appearance.navigation.save')}</Button>
        </div>
      </CardHeader>
      <CardContent className='space-y-3 p-0'>
        <div className='flex flex-wrap gap-2 px-4 pt-4'>
          <Button type='button' variant='outline' onClick={addGroup} disabled={loading}><Plus className='mr-2 h-4 w-4' />{t('appearance.navigation.addSubmenu')}</Button>
          <Button type='button' variant='outline' onClick={addItem} disabled={loading || availableTargets.length === 0}><Plus className='mr-2 h-4 w-4' />{t('appearance.navigation.addItem')}</Button>
          <Button type='button' variant='ghost' onClick={() => { setSettings(structuredClone(DEFAULT_NAVIGATION_SETTINGS)); setDirty(true); }} disabled={loading}><RotateCcw className='mr-2 h-4 w-4' />{t('appearance.navigation.reset')}</Button>
        </div>

        {loading ? <p className='text-sm text-muted-foreground'>{t('appearance.actions.loading')}</p> : (
          <div className='border-y' aria-label={t('appearance.navigation.tree')}>
            <div className='grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_6.5rem] items-center gap-2 bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              <span>{t('appearance.navigation.item')}</span>
              <span className='text-center'>{t('appearance.navigation.sidebar')}</span>
              <span className='text-center'>{t('appearance.navigation.launcher')}</span>
              <span className='sr-only'>{t('appearance.navigation.actions')}</span>
            </div>
            {rows.map(({ node, depth }) => {
              const siblings = sortNavigationNodes(settings, node.parentId);
              const siblingIndex = siblings.findIndex((item) => item.id === node.id);
              const expanded = expandedId === node.id;
              return (
                <div key={node.id} className={cn('border-t first:border-t-0', draggedId === node.id && 'opacity-40')} draggable onDragStart={() => setDraggedId(node.id)} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedId) changeNodes(moveBefore(settings.nodes, draggedId, node.id)); setDraggedId(null); }}>
                  <div className='grid min-h-12 grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_6.5rem] items-center gap-2 px-4 py-1.5'>
                    <button type='button' className='flex min-w-0 items-center gap-2 text-left' style={{ paddingLeft: `${Math.min(depth, 3) * 18}px` }} aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : node.id)}>
                      <GripVertical className='size-4 shrink-0 cursor-grab text-muted-foreground' aria-hidden='true' />
                      <ChevronDown className={cn('size-4 shrink-0 transition-transform', !expanded && '-rotate-90')} />
                      <span className='truncate text-sm font-medium'>{node.labels.en}</span>
                      <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground'>{node.type === 'group' ? t('appearance.navigation.submenu') : t('appearance.navigation.item')}</span>
                    </button>
                    <div className='flex justify-center'><Switch aria-label={`${t('appearance.navigation.sidebar')}: ${node.labels.en}`} checked={node.visible} onCheckedChange={(visible) => updateNode(node.id, { visible })} /></div>
                    <div className='flex justify-center'><Switch aria-label={`${t('appearance.navigation.launcher')}: ${node.labels.en}`} checked={node.launcherVisible ?? true} onCheckedChange={(launcherVisible) => updateNode(node.id, { launcherVisible })} /></div>
                    <div className='flex justify-end gap-0.5'>
                      <Button type='button' variant='ghost' size='icon' aria-label={t('appearance.navigation.moveUp', { name: node.labels.en })} disabled={siblingIndex === 0} onClick={() => move(node, -1)}><ArrowUp className='h-4 w-4' /></Button>
                      <Button type='button' variant='ghost' size='icon' aria-label={t('appearance.navigation.moveDown', { name: node.labels.en })} disabled={siblingIndex === siblings.length - 1} onClick={() => move(node, 1)}><ArrowDown className='h-4 w-4' /></Button>
                      <Button type='button' variant='ghost' size='icon' aria-label={t('appearance.navigation.remove', { name: node.labels.en })} onClick={() => changeNodes(removeBranch(settings.nodes, node.id))}><Trash2 className='h-4 w-4' /></Button>
                    </div>
                  </div>
                  {expanded && <div className='grid gap-3 border-t bg-muted/20 px-4 py-3 md:grid-cols-2 xl:grid-cols-4' style={{ paddingLeft: `${Math.min(depth, 3) * 18 + 40}px` }}>
                    <div><Label htmlFor={`${node.id}-en`}>EN</Label><Input id={`${node.id}-en`} value={node.labels.en} onChange={(event) => updateNode(node.id, { labels: { ...node.labels, en: event.target.value } })} /></div>
                    <div><Label htmlFor={`${node.id}-fr`}>FR</Label><Input id={`${node.id}-fr`} value={node.labels.fr} onChange={(event) => updateNode(node.id, { labels: { ...node.labels, fr: event.target.value } })} /></div>
                    <div><Label htmlFor={`${node.id}-parent`}>{t('appearance.navigation.parent')}</Label><select id={`${node.id}-parent`} className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={node.parentId ?? ''} onChange={(event) => updateNode(node.id, { parentId: event.target.value || null, position: settings.nodes.length })}><option value=''>{t('appearance.navigation.root')}</option>{validParentGroups(settings.nodes, node).map((group) => <option key={group.id} value={group.id}>{group.labels.en}</option>)}</select></div>
                    <div>{node.type === 'item' ? <><Label htmlFor={`${node.id}-target`}>{t('appearance.navigation.target')}</Label><select id={`${node.id}-target`} className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={node.targetKey} onChange={(event) => updateNode(node.id, { targetKey: event.target.value as NavigationTargetKey })}>{(Object.keys(NAVIGATION_TARGETS) as NavigationTargetKey[]).filter((key) => key === node.targetKey || !usedTargets.has(key)).map((key) => <option key={key} value={key}>{NAVIGATION_TARGETS[key].defaultLabels.en}</option>)}</select></> : <p className='pt-6 text-sm text-muted-foreground'>{t('appearance.navigation.submenu')}</p>}</div>
                  </div>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
