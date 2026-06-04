import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Info, Loader2, Pencil, X } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { AdvisorRemediationItem, RemediationCategory, Playbook, PlaybookTask } from '../types';

const CATEGORY_META: Record<RemediationCategory, { labelKey: string; descriptionKey: string; color: string }> = {
  structure: { labelKey: 'detail.remediation.category.structure', descriptionKey: 'detail.remediation.categoryDescription.structure', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  prompt: { labelKey: 'detail.remediation.category.prompt', descriptionKey: 'detail.remediation.categoryDescription.prompt', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  contract: { labelKey: 'detail.remediation.category.contract', descriptionKey: 'detail.remediation.categoryDescription.contract', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  handoff: { labelKey: 'detail.remediation.category.handoff', descriptionKey: 'detail.remediation.categoryDescription.handoff', color: 'bg-rose-100 text-rose-700 border-rose-200' },
  tooling: { labelKey: 'detail.remediation.category.tooling', descriptionKey: 'detail.remediation.categoryDescription.tooling', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  evidence: { labelKey: 'detail.remediation.category.evidence', descriptionKey: 'detail.remediation.categoryDescription.evidence', color: 'bg-sky-100 text-sky-700 border-sky-200' },
  outputFormat: { labelKey: 'detail.remediation.category.outputFormat', descriptionKey: 'detail.remediation.categoryDescription.outputFormat', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  format: { labelKey: 'detail.remediation.category.format', descriptionKey: 'detail.remediation.categoryDescription.format', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  hitl: { labelKey: 'detail.remediation.category.hitl', descriptionKey: 'detail.remediation.categoryDescription.hitl', color: 'bg-red-100 text-red-700 border-red-200' },
  determinism: { labelKey: 'detail.remediation.category.determinism', descriptionKey: 'detail.remediation.categoryDescription.determinism', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  expected_result: { labelKey: 'detail.remediation.category.expected_result', descriptionKey: 'detail.remediation.categoryDescription.expected_result', color: 'bg-amber-100 text-amber-700 border-amber-200' },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AdvisorRemediationItem[];
  tasks: PlaybookTask[];
  mode: 'optimize-step' | 'update-current' | 'generate-new';
  loading?: boolean;
  onApply: (selectedIds: string[], editedItems: Map<string, string>) => Promise<Playbook | void>;
}

export function AdvisorChangeReviewDialog({
  open,
  onOpenChange,
  items,
  tasks,
  mode,
  loading = false,
  onApply,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const [selections, setSelections] = useState<Set<string>>(new Set());
  const [editedItems, setEditedItems] = useState<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [applying, setApplying] = useState(false);
  const [openCategories, setOpenCategories] = useState<Set<RemediationCategory>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const groups = new Map<RemediationCategory, AdvisorRemediationItem[]>();
    for (const item of items) {
      const existing = groups.get(item.category) || [];
      existing.push(item);
      groups.set(item.category, existing);
    }
    const order: RemediationCategory[] = ['structure', 'prompt', 'contract', 'handoff', 'tooling', 'evidence', 'outputFormat', 'format', 'hitl', 'determinism', 'expected_result'];
    return order.filter((cat) => groups.has(cat)).map((cat) => ({
      category: cat,
      items: [...groups.get(cat)!].sort((a, b) => Number(b.defaultSelected) - Number(a.defaultSelected)),
    }));
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const defaults = new Set(items.filter((item) => item.defaultSelected).map((item) => item.id));
    setSelections(defaults);
    setEditedItems(new Map());
    setEditingId(null);
    setEditingText('');
    setOpenCategories(new Set());
    setExpandedItems(new Set());
  }, [open, items]);

  const toggleSelection = useCallback((id: string, checked: boolean) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelections(new Set(items.map((i) => i.id))), [items]);
  const selectRecommended = useCallback(
    () => setSelections(new Set(items.filter((item) => item.defaultSelected).map((item) => item.id))),
    [items],
  );
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

  const taskTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) map.set(task.id, task.title);
    return map;
  }, [tasks]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const selectedIds = Array.from(selections);
      await onApply(selectedIds, editedItems);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  }, [selections, editedItems, onApply, onOpenChange]);

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
                  <button type="button" className="underline hover:text-foreground" onClick={selectRecommended}>{t('detail.remediation.selectRecommended')}</button>
                  <button type="button" className="underline hover:text-foreground" onClick={selectAll}>{t('common.selectAll')}</button>
                  <button type="button" className="underline hover:text-foreground" onClick={deselectAll}>{t('common.deselectAll')}</button>
                </div>
              </div>

              {grouped.map(({ category, items: groupItems }) => {
                const meta = CATEGORY_META[category];
                const recommendedCount = groupItems.filter((item) => item.defaultSelected).length;
                return (
                  <Collapsible
                    key={category}
                    open={openCategories.has(category)}
                    onOpenChange={(nextOpen) => {
                      setOpenCategories((prev) => {
                        const next = new Set(prev);
                        if (nextOpen) next.add(category); else next.delete(category);
                        return next;
                      });
                    }}
                  >
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors">
                      <ChevronDown className="h-4 w-4 shrink-0" />
                      <span className="font-medium">{t(meta.labelKey as any)}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center text-muted-foreground">
                            <Info className="h-3.5 w-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          {t(meta.descriptionKey as any)}
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-xs text-muted-foreground">{t('detail.remediation.suggestionCount', { count: groupItems.length })}</span>
                      {recommendedCount > 0 && (
                        <Badge variant="outline" className="ml-auto text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                          {t('detail.remediation.recommendedCount', { count: recommendedCount })}
                        </Badge>
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2 pl-2">
                      {groupItems.map((item) => {
                        const selected = selections.has(item.id);
                        const isEditing = editingId === item.id;
                        const effectiveDescription = editedItems.get(item.id) || item.description;
                        const expanded = expandedItems.has(item.id);

                        return (
                          <div key={item.id} className={cn(
                            'rounded-lg border p-3 text-sm transition-colors',
                            selected ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-muted/10',
                            item.defaultSelected && !selected && 'border-emerald-200/70 bg-emerald-50/40',
                          )}>
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={selected}
                                onCheckedChange={(checked) => toggleSelection(item.id, !!checked)}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="mb-1 flex items-center gap-2">
                                  {item.defaultSelected && (
                                    <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                                      {t('detail.remediation.recommended')}
                                    </Badge>
                                  )}
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
                                  <>
                                    <p className={cn('text-sm text-muted-foreground whitespace-pre-wrap', !expanded && 'line-clamp-2')}>
                                      {effectiveDescription}
                                    </p>
                                    {effectiveDescription.length > 140 && (
                                      <button
                                        type="button"
                                        className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
                                        onClick={() => {
                                          setExpandedItems((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                                            return next;
                                          });
                                        }}
                                      >
                                        {expanded ? t('detail.remediation.showLess') : t('detail.remediation.showMore')}
                                      </button>
                                    )}
                                  </>
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
                                        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" onClick={() => startEdit(item)}>
                                          <Pencil className="h-3 w-3" />
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
          <Button onClick={handleApply} disabled={applying || loading}>
            {(applying || loading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('detail.remediation.applySelected', { count: selections.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
