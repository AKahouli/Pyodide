import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Agent } from '../types';
import { getAgentMemories, deleteAgentMemories, type MemoryCard } from '../memoryCardsApi';

interface AgentMemoriesModalProps {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When false (e.g. read-only shared agent), memories are view-only. */
  canDelete?: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function AgentMemoriesModal({
  agent,
  open,
  onOpenChange,
  canDelete = true,
}: Readonly<AgentMemoriesModalProps>) {
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [rows, setRows] = useState<MemoryCard[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Fetch the agent's memories each time the modal is opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setRows([]);
    setSelected(new Set());

    getAgentMemories(agent.id)
      .then((memories) => {
        if (!cancelled) setRows(memories);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error('Impossible de charger les mémoires', {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, agent.id]);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      await deleteAgentMemories(agent.id, ids);
      setRows((prev) => prev.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
      toast.success(
        ids.length === 1 ? 'Mémoire supprimée' : `${ids.length} mémoires supprimées`,
      );
    } catch (err) {
      toast.error('Échec de la suppression', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const selectedCount = selected.size;
  const hasRows = rows.length > 0;
  const description = useMemo(() => `Mémoires de l'agent « ${agent.name} »`, [agent.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Mémoires</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des mémoires…
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {rows.length} mémoire{rows.length === 1 ? '' : 's'}
                {selectedCount > 0 ? ` · ${selectedCount} sélectionnée${selectedCount === 1 ? '' : 's'}` : ''}
              </span>
              {canDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selectedCount === 0 || deleting}
                  onClick={deleteSelected}
                  className="gap-1.5"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Supprimer la sélection
                </Button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md border">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    {canDelete && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(c) => toggleAll(c === true)}
                          aria-label="Tout sélectionner"
                          disabled={!hasRows}
                        />
                      </TableHead>
                    )}
                    <TableHead>id</TableHead>
                    <TableHead>title</TableHead>
                    <TableHead>summary</TableHead>
                    <TableHead>content</TableHead>
                    <TableHead>type</TableHead>
                    <TableHead>keywords</TableHead>
                    <TableHead>valid_from</TableHead>
                    <TableHead>valid_until</TableHead>
                    <TableHead>created_at</TableHead>
                    <TableHead>updated_at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!hasRows ? (
                    <TableRow>
                      <TableCell colSpan={canDelete ? 11 : 10} className="h-24 text-center text-muted-foreground">
                        Aucune mémoire.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => {
                      const isChecked = selected.has(row.id);
                      return (
                        <TableRow key={row.id} data-state={isChecked ? 'selected' : undefined}>
                          {canDelete && (
                            <TableCell>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(c) => toggleOne(row.id, c === true)}
                                aria-label={`Sélectionner ${row.title}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                            {row.id}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium">{row.title}</TableCell>
                          <TableCell className="max-w-[220px] truncate" title={row.summary}>
                            {row.summary}
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate" title={row.content}>
                            {row.content}
                          </TableCell>
                          <TableCell>
                            {row.type && (
                              <Badge variant="secondary" className="text-[10px]">
                                {row.type}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {row.keywords.map((kw) => (
                                <Badge key={kw} variant="outline" className="text-[10px]">
                                  {kw}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatDate(row.valid_from)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatDate(row.valid_until)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatDate(row.created_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatDate(row.updated_at)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
