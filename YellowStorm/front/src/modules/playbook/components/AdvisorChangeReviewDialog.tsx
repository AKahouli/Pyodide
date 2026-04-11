import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Edit3, Loader2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { AdvisorRemediationItem, RemediationCategory, Playbook, PlaybookTask } from '../types';

const CATEGORY_META: Record<RemediationCategory, { labelKey: string; color: string }> = {
  structure: { labelKey: 'detail.remediation.category.structure', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  prompt: { labelKey: 'detail.remediation.category.prompt', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  contract: { labelKey: 'detail.remediation.category.contract', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  handoff: { labelKey: 'detail.remediation.category.handoff', color: 'bg-rose-100 text-rose-700 border-rose-200' },
  tooling: { labelKey: 'detail.remediation.category.tooling', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  evidence: { labelKey: 'detail.remediation.category.evidence', color: 'bg-sky-100 text-sky-700 border-sky-200' },
  outputFormat: { labelKey: 'detail.remediation.category.outputFormat', color: 'bg-orange-100 text-orange-700 border-orange-200' },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AdvisorRemediationItem[];
  tasks: PlaybookTask[];
  mode: 'optimize-step' | 'update-current' | 'generate-new';
  loading?: boolean;
  onApply: (selectedIds: string[], editedItems: Map<string, string>) => Promise<Playbook | void>;
  onGenerate?: (selectedIds: string[], editedItems: Map<string, string>) => Promise<Playbook | void>;
}

export function AdvisorChangeReviewDialog({
  open,
  onOpenChange,
  items,
  tasks,
  mode,
  loading = false,
  onApply,
  onGenerate,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const [selections, setSelections] = useState<Set<string>>(new Set());
  const [editedItems, setEditedItems] = useState<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const defaults = new Set(items.filter((item) => item.defaultSelected).map((item) => item.id));
    setSelections(defaults);
    setEditedItems(new Map());
    setEditingId(null);
    setEditingText('');
  }, [open, items]);

  const toggleSelection = useCallback((id: string, checked: boolean) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelections(new Set(items.map((i) => i.id))), [items]);
  const deselectAll = useCallback(() => setSelections(new Set()), []);

  const startEdit = useCallback((item: AdvisorRemediationItem) => {
    setEditingId(item.id);
    setEditingText(editedItems.get(item.id) || item.description);
  }, [editedItems]);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    setEditedItems((prev) => {
      const next = new Map(prev);
      next.set(editingId, editingText);
      return next;
    });
    setEditingId(null);
  }, [editingId, editingText]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingText('');
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<RemediationCategory, AdvisorRemediationItem[]>();
    for (const item of items) {
      const existing = groups.get(item.category) || [];
      existing.push(item);
      groups.set(item.category, existing);
    }
    const order: RemediationCategory[] = ['structure', 'prompt', 'contract', 'handoff', 'tooling', 'evidence', 'outputFormat'];
    return order.filter((cat) => groups.has(cat)).map((cat) => ({ category: cat, items: groups.get(cat)! }));
  }, [items]);

  const taskTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) map.set(task.id, task.title);
    return map;
  }, [tasks]);

  const handleApply = useCallback(async () => {
    if (selections.size === 0) return;
    setApplying(true);
    try {
      const selectedIds = Array.from(selections);
      if (mode === 'generate-new' && onGenerate) {
        const created = await onGenerate(selectedIds, editedItems);
        onOpenChange(false);
        return created;
      }
      await onApply(selectedIds, editedItems);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  }, [selections, editedItems, mode, onApply, onGenerate, onOpenChange]);

  const title =
    mode === 'generate-new'
      ? t('detail.remediation.generateNewTitle')
      : mode === 'optimize-step'
        ? t('detail.remediation.optimizeStepTitle')
        : t('detail.remediation.updateCurrentTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('detail.remediation.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {items.length === 0 ? (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              {t('detail.remediation.noItems')}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('detail.remediation.selectedCount', { count: selections.size, total: items.length })}</span>
                <div className="flex gap-2">
                  <button type="button" className="underline hover:text-foreground" onClick={selectAll}>{t('common.selectAll')}</button>
                  <button type="button" className="underline hover:text-foreground" onClick={deselectAll}>{t('common.deselectAll')}</button>
                </div>
              </div>

              {grouped.map(({ category, items: groupItems }) => {
                const meta = CATEGORY_META[category];
                return (
                  <Collapsible key={category} defaultOpen>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors">
                      <ChevronDown className="h-4 w-4 shrink-0" />
                      <Badge variant="outline" className={cn('text-[10px] border', meta.color)}>
                        {t(meta.labelKey as any)}
                      </Badge>
                      <span className="text-muted-foreground">{groupItems.length}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2 pl-2">
                      {groupItems.map((item) => {
                        const selected = selections.has(item.id);
                        const isEditing = editingId === item.id;
                        const effectiveDescription = editedItems.get(item.id) || item.description;

                        return (
                          <div key={item.id} className={cn(
                            'rounded-lg border p-3 text-sm transition-colors',
                            selected ? 'border-primary/40 bg-primary/5' : 'border-transparent bg-muted/20',
                          )}>
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={selected}
                                onCheckedChange={(checked) => toggleSelection(item.id, !!checked)}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {item.targetTaskId && (
                                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                                      {taskTitleMap.get(item.targetTaskId) || item.targetTaskId}
                                    </span>
                                  )}
                                </div>

                                {isEditing ? (
                                  <textarea
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    rows={3}
                                    className="w-full rounded border bg-background px-2 py-1.5 text-sm font-mono resize-y"
                                    autoFocus
                                  />
                                ) : (
                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{effectiveDescription}</p>
                                )}

                                <div className="mt-2 flex items-center gap-1">
                                  {item.editable && (
                                    <>
                                      {isEditing ? (
                                        <>
                                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={saveEdit}>
                                            <Check className="mr-1 h-3 w-3" />
                                            {t('common.save')}
                                          </Button>
                                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelEdit}>
                                            <X className="mr-1 h-3 w-3" />
                                            {t('common.cancel')}
                                          </Button>
                                        </>
                                      ) : (
                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => startEdit(item)}>
                                          <Pencil className="mr-1 h-3 w-3" />
                                          {t('detail.remediation.edit')}
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleApply} disabled={selections.size === 0 || applying || loading}>
            {(applying || loading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('detail.remediation.applySelected', { count: selections.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
