/**
 * ToolsPage - Tool management for admin
 */

import { useCallback, useEffect, useState } from "react";
import {
  FolderTree,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  getToolCategories,
} from "../api";
import type { ToolResponse, ToolListResponse, ToolCategoryResponse } from "../types";
import { CreateEditToolDialog } from "./tools/CreateEditToolDialog";
import { ManageToolCategoriesDialog } from "./tools/ManageToolCategoriesDialog";
import { IconDisplay } from "./connectors/IconDisplay";
import type { ToolFormValues } from "./tools/tool-form-schema";
import { useModuleTranslation } from "@/modules/localization";

const CARDS_PER_CATEGORY = 6;
const UNCATEGORIZED_KEY = "__uncategorized__";

export function ToolsPage() {
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<ToolCategoryResponse[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [saving, setSaving] = useState(false);

  // Dialog states
  const [showCreateEditDialog, setShowCreateEditDialog] = useState(false);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [editingTool, setEditingTool] = useState<ToolResponse | null>(null);
  const [deletingTool, setDeletingTool] = useState<ToolResponse | null>(null);

  const fetchTools = useCallback(async (searchValue?: string) => {
    setLoading(true);
    setError(null);

    try {
      const data: ToolListResponse = await getTools({
        page: 1,
        limit: 1000,
        search: searchValue ?? search,
      });
      setTools(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("defaultTools.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await getToolCategories();
      setCategories(data);
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    void fetchTools();
    void fetchCategories();
  }, [fetchTools, fetchCategories]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchTools(search);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleCategoryExpanded = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupedTools = (() => {
    const byCategory = new Map<string, ToolResponse[]>();
    for (const tool of tools) {
      const key = tool.categoryId || UNCATEGORIZED_KEY;
      const list = byCategory.get(key) ?? [];
      list.push(tool);
      byCategory.set(key, list);
    }
    const groups: Array<{ key: string; name: string; description: string; items: ToolResponse[] }> = [];
    for (const cat of categories) {
      const items = byCategory.get(cat.id);
      if (items && items.length > 0) {
        groups.push({ key: cat.id, name: cat.name, description: cat.description, items });
      }
    }
    const uncategorized = byCategory.get(UNCATEGORIZED_KEY);
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ key: UNCATEGORIZED_KEY, name: "Uncategorized", description: "", items: uncategorized });
    }
    return groups;
  })();

  const visibleGroups = categoryFilter === "__all__"
    ? groupedTools
    : groupedTools.filter((group) => group.key === categoryFilter);

  const handleSave = async (data: ToolFormValues) => {
    setSaving(true);

    try {
      if (editingTool) {
        await updateTool(editingTool.id, {
          name: data.name,
          description: data.description,
          icon: data.icon || undefined,
          color: data.color || undefined,
          iconColor: data.iconColor || undefined,
          categoryId: data.categoryId ? data.categoryId : null,
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
          icon: data.icon || undefined,
          color: data.color || undefined,
          iconColor: data.iconColor || undefined,
          categoryId: data.categoryId ? data.categoryId : null,
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
          <Button variant="outline" onClick={() => setShowCategoriesDialog(true)}>
            <FolderTree className="mr-2 h-4 w-4" />
            Manage Categories
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("defaultTools.actions.add")}
          </Button>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("defaultTools.search.placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
            <SelectItem value={UNCATEGORIZED_KEY}>Uncategorized</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("defaultTools.card.description", { count: total })}
      </p>

      {tools.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground">
          {search
            ? t("defaultTools.table.empty.search")
            : t("defaultTools.table.empty.default")}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground">
          No tools in this category.
        </div>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group) => {
            const isExpanded = expandedCategories.has(group.key);
            const visible = isExpanded ? group.items : group.items.slice(0, CARDS_PER_CATEGORY);
            const hasMore = group.items.length > CARDS_PER_CATEGORY;
            return (
              <section key={group.key} className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold">{group.name}</h3>
                  {group.description && (
                    <p className="text-sm text-muted-foreground">{group.description}</p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visible.map((tool) => {
                    const iconTextColor = tool.iconColor === "dark" ? "text-black" : "text-white";
                    const initial = tool.name?.trim().charAt(0).toUpperCase() || "?";
                    return (
                      <div
                        key={tool.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(tool)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openEdit(tool);
                          }
                        }}
                        className={`group relative rounded-lg border bg-card p-4 cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring ${!tool.isActive ? "opacity-60" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await handleToggleActive(tool);
                          }}
                          className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={tool.isActive ? "Deactivate tool" : "Activate tool"}
                          aria-pressed={tool.isActive}
                          title={tool.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                        >
                          <span className={`h-2.5 w-2.5 rounded-full transition-colors ${tool.isActive ? "bg-green-500" : "bg-red-500"}`} />
                        </button>

                        <div className="absolute top-2 right-9 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); openEdit(tool); }}
                            aria-label="Edit tool"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeletingTool(tool); }}
                            aria-label="Delete tool"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="flex items-start gap-3 pr-12">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
                            style={{ backgroundColor: tool.color || "transparent" }}
                          >
                            {tool.icon ? (
                              <IconDisplay icon={tool.icon} size={22} iconColor={tool.iconColor} />
                            ) : (
                              <span className={`text-sm font-bold ${iconTextColor}`}>{initial}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate">{tool.name}</div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {tool.description || "-"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasMore && (
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => toggleCategoryExpanded(group.key)}>
                      {isExpanded ? "Show less" : `View all (${group.items.length})`}
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

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

      <ManageToolCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        onCategoriesChanged={() => { void fetchCategories(); void fetchTools(); }}
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
