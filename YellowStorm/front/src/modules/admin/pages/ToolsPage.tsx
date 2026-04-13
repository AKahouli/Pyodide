/**
 * ToolsPage - Tool management for admin
 */

import { useCallback, useEffect, useState } from "react";
import {
  Wrench,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Search,
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
  getTools,
  createTool,
  updateTool,
  deleteTool,
} from "../api";
import type { ToolResponse, ToolListResponse } from "../types";
import { CreateEditToolDialog } from "./tools/CreateEditToolDialog";
import type { ToolFormValues } from "./tools/tool-form-schema";
import { useModuleTranslation } from "@/modules/localization";
import type { ModuleTranslationKey } from "@/modules/localization";

const AGENT_TYPE_LABEL_KEYS: Record<string, ModuleTranslationKey<"admin">> = {
  manager: "defaultTools.agentTypes.manager",
  visualizer: "defaultTools.agentTypes.visualizer",
  simple: "defaultTools.agentTypes.simple",
};

export function ToolsPage() {
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Dialog states
  const [showCreateEditDialog, setShowCreateEditDialog] = useState(false);
  const [editingTool, setEditingTool] = useState<ToolResponse | null>(null);
  const [deletingTool, setDeletingTool] = useState<ToolResponse | null>(null);

  const fetchTools = useCallback(async (searchValue?: string, pageValue?: number) => {
    setLoading(true);
    setError(null);

    try {
      const data: ToolListResponse = await getTools({
        page: pageValue ?? page,
        limit: 10,
        search: searchValue ?? search,
      });
      setTools(data.data);
      setTotal(data.meta.total);
      setTotalPages(data.meta.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("defaultTools.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [page, search, t]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchTools(search, 1);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSave = async (data: ToolFormValues) => {
    setSaving(true);

    try {
      if (editingTool) {
        await updateTool(editingTool.id, {
          name: data.name,
          description: data.description,
          defaultAgentTypes: data.defaultAgentTypes,
          attributes: data.attributes,
          requiredAppKey: data.requiredAppKey || undefined,
          isActive: data.isActive,
        });
        toast.success(t("defaultTools.toasts.updated.title"), {
          description: t("defaultTools.toasts.updated.description", { name: data.name }),
        });
      } else {
        await createTool({
          name: data.name,
          description: data.description,
          defaultAgentTypes: data.defaultAgentTypes,
          attributes: data.attributes,
          requiredAppKey: data.requiredAppKey || undefined,
          isActive: data.isActive,
        });
        toast.success(t("defaultTools.toasts.created.title"), {
          description: t("defaultTools.toasts.created.description", { name: data.name }),
        });
      }
      setShowCreateEditDialog(false);
      setEditingTool(null);
      fetchTools();
    } catch (err) {
      toast.error(
        editingTool ? t("defaultTools.toasts.errors.update") : t("defaultTools.toasts.errors.create"),
        {
          description: err instanceof Error ? err.message : tCommon("errorUnknown"),
        },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (tool: ToolResponse) => {
    try {
      const updated = await updateTool(tool.id, { isActive: !tool.isActive });
      setTools((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
      toast.success(
        updated.isActive
          ? t("defaultTools.toasts.statusActivated.title")
          : t("defaultTools.toasts.statusDeactivated.title"),
        {
          description: t(
            updated.isActive
              ? "defaultTools.toasts.statusActivated.description"
              : "defaultTools.toasts.statusDeactivated.description",
            { name: updated.name },
          ),
        },
      );
    } catch (err) {
      toast.error(t("defaultTools.toasts.errors.status"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingTool) return;

    try {
      await deleteTool(deletingTool.id);
      toast.success(t("defaultTools.toasts.deleted.title"), {
        description: t("defaultTools.toasts.deleted.description", { name: deletingTool.name }),
      });
      setDeletingTool(null);
      fetchTools();
    } catch (err) {
      toast.error(t("defaultTools.toasts.errors.delete"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    }
  };

  const openCreate = () => {
    setEditingTool(null);
    setShowCreateEditDialog(true);
  };

  const openEdit = (tool: ToolResponse) => {
    setEditingTool(tool);
    setShowCreateEditDialog(true);
  };

  if (loading && tools.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => fetchTools()} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("defaultTools.title")}</h1>
          <p className="text-muted-foreground">{t("defaultTools.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fetchTools()} variant="outline" size="icon">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("defaultTools.actions.add")}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("defaultTools.search.placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tools Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t("defaultTools.card.title")}</CardTitle>
              <CardDescription>{t("defaultTools.card.description", { count: total })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("defaultTools.table.columns.name")}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("defaultTools.table.columns.description")}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("defaultTools.table.columns.agentTypes")}
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t("defaultTools.table.columns.attributes")}
                  </TableHead>
                  <TableHead>{t("defaultTools.table.columns.active")}</TableHead>
                  <TableHead className="text-right">{t("defaultTools.table.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      {search
                        ? t("defaultTools.table.empty.search")
                        : t("defaultTools.table.empty.default")}
                    </TableCell>
                  </TableRow>
                ) : (
                  tools.map((tool) => (
                    <TableRow
                      key={tool.id}
                      className={!tool.isActive ? "opacity-50" : undefined}
                    >
                      <TableCell>
                        <span className="font-medium">{tool.name}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell max-w-[200px] truncate">
                        {tool.description || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {tool.defaultAgentTypes.length > 0 ? (
                            tool.defaultAgentTypes.map((type) => {
                              const agentTypeKey =
                                AGENT_TYPE_LABEL_KEYS[type as keyof typeof AGENT_TYPE_LABEL_KEYS] ??
                                "defaultTools.agentTypes.fallback";
                              return (
                                <Badge key={type} variant="secondary" className="text-xs">
                                  {t(agentTypeKey as ModuleTranslationKey<"admin">, { type })}
                                </Badge>
                              );
                            })
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {t("defaultTools.table.noAgentTypes")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {tool.attributes.length}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={tool.isActive}
                          onCheckedChange={() => handleToggleActive(tool)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(tool)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingTool(tool)}
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                {t("defaultTools.pagination.summary", { page, totalPages })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={page <= 1}
                >
                  {t("defaultTools.pagination.previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPage((p) => Math.min(totalPages, p + 1));
                  }}
                  disabled={page >= totalPages}
                >
                  {t("defaultTools.pagination.next")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <CreateEditToolDialog
        open={showCreateEditDialog}
        onOpenChange={(open) => {
          setShowCreateEditDialog(open);
          if (!open) setEditingTool(null);
        }}
        tool={editingTool}
        onSave={handleSave}
        saving={saving}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingTool}
        onOpenChange={(open) => {
          if (!open) setDeletingTool(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("defaultTools.dialog.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("defaultTools.dialog.delete.description", { name: deletingTool?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actionCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("defaultTools.dialog.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
