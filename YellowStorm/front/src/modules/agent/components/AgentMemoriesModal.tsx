import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

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

interface AgentMemory {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: string;
  keywords: string[];
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentMemoriesModalProps {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Simulated latency for the webapp → mcp → postgres → mcp → webapp round-trip.
const FAKE_FETCH_MS = 900;

// Static fake dataset (no backend yet). Kept deterministic so the table is stable.
function buildFakeMemories(agentName: string): AgentMemory[] {
  return [
    {
      id: 'mem_01H9X2A',
      title: 'Préférences de ton',
      summary: `${agentName} doit répondre de façon concise et professionnelle.`,
      content:
        "L'utilisateur préfère des réponses courtes, sans formules de politesse superflues, et en français.",
      type: 'preference',
      keywords: ['ton', 'concision', 'français'],
      valid_from: '2026-01-05T09:00:00Z',
      valid_until: null,
      created_at: '2026-01-05T09:00:00Z',
      updated_at: '2026-02-11T14:22:00Z',
    },
    {
      id: 'mem_01H9X3B',
      title: 'Stack technique',
      summary: 'Projet principal en NestJS + React.',
      content:
        'Backend NestJS (Mongo + gRPC), frontend React/Vite/Tailwind. Éviter les suggestions Angular.',
      type: 'fact',
      keywords: ['nestjs', 'react', 'tailwind'],
      valid_from: '2026-01-12T10:30:00Z',
      valid_until: null,
      created_at: '2026-01-12T10:30:00Z',
      updated_at: '2026-01-12T10:30:00Z',
    },
    {
      id: 'mem_01H9X4C',
      title: 'Fuseau horaire',
      summary: 'Utilisateur basé à Tunis (UTC+1).',
      content: 'Planifier les rappels et échéances en heure de Tunis.',
      type: 'fact',
      keywords: ['timezone', 'tunis'],
      valid_from: '2026-01-20T08:00:00Z',
      valid_until: '2026-12-31T23:59:00Z',
      created_at: '2026-01-20T08:00:00Z',
      updated_at: '2026-03-02T11:05:00Z',
    },
    {
      id: 'mem_01H9X5D',
      title: 'Objectif du trimestre',
      summary: 'Livrer la refonte du hub workspace.',
      content:
        'Priorité au portage des features v1 vers la conversation v2 avant fin de trimestre.',
      type: 'goal',
      keywords: ['roadmap', 'workspace', 'v2'],
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2026-03-31T23:59:00Z',
      created_at: '2026-01-02T16:45:00Z',
      updated_at: '2026-02-28T09:12:00Z',
    },
    {
      id: 'mem_01H9X6E',
      title: 'Format des livrables',
      summary: 'Toujours fournir un récap + les fichiers touchés.',
      content:
        'À la fin d\'une tâche, résumer les changements et lister les fichiers avec des liens cliquables.',
      type: 'instruction',
      keywords: ['livrable', 'récap'],
      valid_from: '2026-02-01T00:00:00Z',
      valid_until: null,
      created_at: '2026-02-01T12:00:00Z',
      updated_at: '2026-02-01T12:00:00Z',
    },
  ];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function AgentMemoriesModal({ agent, open, onOpenChange }: Readonly<AgentMemoriesModalProps>) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgentMemory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Simulate the (slow) fetch every time the modal is opened.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setRows([]);
    setSelected(new Set());
    const timer = setTimeout(() => {
      setRows(buildFakeMemories(agent.name));
      setLoading(false);
    }, FAKE_FETCH_MS);
    return () => clearTimeout(timer);
  }, [open, agent.name]);

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

  const deleteSelected = () => {
    // Static: remove from local state only (no persistence yet).
    setRows((prev) => prev.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
  };

  const selectedCount = selected.size;
  const hasRows = rows.length > 0;
  const description = useMemo(
    () => `Mémoires de l'agent « ${agent.name} »`,
    [agent.name],
  );

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
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedCount === 0}
                onClick={deleteSelected}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer la sélection
              </Button>
            </div>

            <div className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md border">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(c) => toggleAll(c === true)}
                        aria-label="Tout sélectionner"
                        disabled={!hasRows}
                      />
                    </TableHead>
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
                      <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                        Aucune mémoire.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => {
                      const isChecked = selected.has(row.id);
                      return (
                        <TableRow key={row.id} data-state={isChecked ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(c) => toggleOne(row.id, c === true)}
                              aria-label={`Sélectionner ${row.title}`}
                            />
                          </TableCell>
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
                            <Badge variant="secondary" className="text-[10px]">
                              {row.type}
                            </Badge>
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
