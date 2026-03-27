/**
 * AgentTypesPage - Agent type management for admin
 */

import { useCallback, useEffect, useState } from "react";
import {
  Puzzle,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Search,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getAgentTypes,
  createAgentType,
  updateAgentType,
  deleteAgentType,
} from "../api";
import type { AgentTypeResponse, AgentTypeListResponse } from "../types";
import { CreateEditAgentTypeDialog } from "./agent-types/CreateEditAgentTypeDialog";
import { AgentTypePromptsDialog } from "./agent-types/AgentTypePromptsDialog";
import type { AgentTypeFormValues } from "./agent-types/agent-type-form-schema";
import { useModuleTranslation } from "@/modules/localization";

export function AgentTypesPage() {
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentTypes, setAgentTypes] = useState<AgentTypeResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [showCreateEditDialog, setShowCreateEditDialog] = useState(false);
  const [editingAgentType, setEditingAgentType] = useState<AgentTypeResponse | null>(null);
  const [deletingAgentType, setDeletingAgentType] = useState<AgentTypeResponse | null>(null);
  const [promptsAgentType, setPromptsAgentType] = useState<AgentTypeResponse | null>(null);

  const fetchAgentTypes = useCallback(async (searchValue?: string, pageValue?: number) => {
    setLoading(true);
    setError(null);

    try {
      const data: AgentTypeListResponse = await getAgentTypes({
        page: pageValue ?? page,
        limit: 10,
        search: searchValue ?? search,
      });
      setAgentTypes(data.data);
      setTotal(data.meta.total);
      setTotalPages(data.meta.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agentTypes.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [page, search, t]);

  useEffect(() => {
    fetchAgentTypes();
  }, [fetchAgentTypes]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchAgentTypes(search, 1);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSave = async (data: AgentTypeFormValues) => {
    setSaving(true);
    try {
      if (editingAgentType) {
        await updateAgentType(editingAgentType.id, {
          name: data.name,
          defaultPrompt: data.defaultPrompt,
          isActive: data.isActive,
        });
        toast.success(t("agentTypes.toasts.updated.title"), {
          description: t("agentTypes.toasts.updated.description", { name: data.name }),
        });
      } else {
        await createAgentType({
          name: data.name,
          defaultPrompt: data.defaultPrompt,
          isActive: data.isActive,
        });
        toast.success(t("agentTypes.toasts.created.title"), {
          description: t("agentTypes.toasts.created.description", { name: data.name }),
        });
      }
      setShowCreateEditDialog(false);
      setEditingAgentType(null);
      fetchAgentTypes();
    } catch (err) {
      toast.error(
        editingAgentType ? t("agentTypes.toasts.errors.update") : t("agentTypes.toasts.errors.create"),
        {
          description: err instanceof Error ? err.message : tCommon("errorUnknown"),
        },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (agentType: AgentTypeResponse) => {
    try {
      const updated = await updateAgentType(agentType.id, { isActive: !agentType.isActive });
      setAgentTypes((prev) =>
        prev.map((at) => (at.id === updated.id ? updated : at))
      );
      toast.success(
        updated.isActive ? t("agentTypes.toasts.statusActivated.title") : t("agentTypes.toasts.statusDeactivated.title"),
        {
          description: t(
            updated.isActive ? "agentTypes.toasts.statusActivated.description" : "agentTypes.toasts.statusDeactivated.description",
            { name: updated.name },
          ),
        },
      );
    } catch (err) {
      toast.error(t("agentTypes.toasts.errors.status"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingAgentType) return;
    try {
      await deleteAgentType(deletingAgentType.id);
      toast.success(t("agentTypes.toasts.deleted.title"), {
        description: t("agentTypes.toasts.deleted.description", { name: deletingAgentType.name }),
      });
      setDeletingAgentType(null);
      fetchAgentTypes();
    } catch (err) {
      toast.error(t("agentTypes.toasts.errors.delete"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    }
  };

  const openCreate = () => {
    setEditingAgentType(null);
    setShowCreateEditDialog(true);
  };

  const openEdit = (agentType: AgentTypeResponse) => {
    setEditingAgentType(agentType);
    setShowCreateEditDialog(true);
  };

  if (loading && agentTypes.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && agentTypes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => fetchAgentTypes()} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          {tCommon("actionRetry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("agentTypes.title")}</h1>
          <p className="text-muted-foreground">{t("agentTypes.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fetchAgentTypes()} variant="outline" size="icon">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("agentTypes.actions.add")}
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("agentTypes.search.placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Puzzle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t("agentTypes.card.title")}</CardTitle>
              <CardDescription>{t("agentTypes.card.description", { count: total })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("agentTypes.table.columns.name")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("agentTypes.table.columns.prompts")}</TableHead>
                  <TableHead>{t("agentTypes.table.columns.active")}</TableHead>
                  <TableHead className="text-right">{t("agentTypes.table.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      {search
                        ? t("agentTypes.table.empty.search")
                        : t("agentTypes.table.empty.default")}
                    </TableCell>
                  </TableRow>
                ) : (
                  agentTypes.map((agentType) => (
                    <TableRow
                      key={agentType.id}
                      className={!agentType.isActive ? "opacity-50" : undefined}
                    >
                      <TableCell>
                        <span className="font-medium">{agentType.name}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {agentType.promptCount > 0 ? (
                          <Badge variant="secondary">
                            {t("agentTypes.table.promptsCount", { count: agentType.promptCount })}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">{t("agentTypes.table.promptsDefaultOnly")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={agentType.isActive}
                          onCheckedChange={() => handleToggleActive(agentType)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("agentTypes.table.actions.prompts")}
                            onClick={() => setPromptsAgentType(agentType)}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(agentType)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingAgentType(agentType)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                {t("agentTypes.pagination.summary", { page, totalPages })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  {t("agentTypes.pagination.previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  {t("agentTypes.pagination.next")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateEditAgentTypeDialog
        open={showCreateEditDialog}
        onOpenChange={(open) => {
          setShowCreateEditDialog(open);
          if (!open) setEditingAgentType(null);
        }}
        agentType={editingAgentType}
        onSave={handleSave}
        saving={saving}
      />

      <AgentTypePromptsDialog
        open={!!promptsAgentType}
        onOpenChange={(open) => {
          if (!open) {
            setPromptsAgentType(null);
            // Refresh to update prompt counts
            fetchAgentTypes();
          }
        }}
        agentType={promptsAgentType}
      />

      <AlertDialog
        open={!!deletingAgentType}
        onOpenChange={(open) => {
          if (!open) setDeletingAgentType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("agentTypes.dialog.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentTypes.dialog.delete.description", { name: deletingAgentType?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actionCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("agentTypes.dialog.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
