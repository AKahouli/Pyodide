import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Trash2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50] as const;

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
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pagination + search state.
  const [page, setPage] = useState(1); // 1-based
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [searchInput, setSearchInput] = useState(''); // live input value
  const [search, setSearch] = useState(''); // applied term (on Enter)
  // Bumped to force a refetch of the current page (e.g. after a deletion).
  const [reloadNonce, setReloadNonce] = useState(0);

  // Reset pagination/search when the modal closes so it reopens clean.
  useEffect(() => {
    if (open) return;
    setPage(1);
    setPageSize(PAGE_SIZE_OPTIONS[0]);
    setSearchInput('');
    setSearch('');
  }, [open]);

  // Fetch the current page whenever the modal is open and any query input changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelected(new Set());

    getAgentMemories(agent.id, { page, pageSize, search })
      .then((res) => {
        if (cancelled) return;
        setRows(res.memories);
        setTotal(res.total);
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
  }, [open, agent.id, page, pageSize, search, reloadNonce]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const applySearch = () => {
    const term = searchInput.trim();
    setPage(1);
    setSearch(term);
  };

  const changePageSize = (value: string) => {
    setPage(1);
    setPageSize(Number(value));
  };

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
      setSelected(new Set());
      toast.success(
        ids.length === 1 ? 'Mémoire supprimée' : `${ids.length} mémoires supprimées`,
      );
      // Refetch the current page from the server so total/pagination stay accurate.
      // If we emptied the last page, step back one page (that itself triggers a refetch).
      const removedWholePage = ids.length >= rows.length;
      if (removedWholePage && page > 1) {
        setPage((p) => p - 1);
      } else {
        setReloadNonce((n) => n + 1);
      }
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

        <div className="min-w-0 space-y-3">
            {/* Search, submitted on Enter. */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch();
                }}
                placeholder="Rechercher… (Entrée pour valider)"
                className="pl-8 pr-8"
              />
              {loading && (
                <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              {total} mémoire{total === 1 ? '' : 's'}
              {selectedCount > 0 ? ` · ${selectedCount} sélectionnée${selectedCount === 1 ? '' : 's'}` : ''}
            </div>

            <div className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md border">
              {loading && rows.length === 0 ? (
                <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Chargement des mémoires…
                </div>
              ) : (
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
              )}
            </div>

            {/* Bottom bar: delete (only when a memory is selected) · page size · pagination. */}
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div className="flex items-center gap-3">
                {canDelete && selectedCount > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
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
                <span className="text-xs text-muted-foreground">
                  Page {page} / {totalPages}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={changePageSize}>
                  <SelectTrigger className="h-8 w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size} / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Page précédente"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={loading || page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Page suivante"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
