import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { showError, showSuccess, showWarning } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { getCorsSettings, setCorsSettings } from "../api";
import { usePermissions } from "../hooks/usePermissions";
import type { CorsOriginEntry } from "../types";

const ORIGIN_PATTERN = /^https?:\/\/.+/;

function normalizeOrigin(value: string): string {
  return value.trim();
}

function isValidOrigin(value: string): boolean {
  return ORIGIN_PATTERN.test(normalizeOrigin(value));
}

function parseCorsOrigins(raw: unknown): CorsOriginEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") {
      return { origin: item, enabled: true };
    }
    if (item && typeof item === "object" && "origin" in item) {
      const entry = item as CorsOriginEntry;
      return {
        origin: String(entry.origin),
        enabled: entry.enabled !== false,
      };
    }
    return null;
  }).filter((entry): entry is CorsOriginEntry => entry !== null);
}

export function CorsSettingsCard() {
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const { hasPermission } = usePermissions();

  const canManage =
    hasPermission("system.cors") || hasPermission("system.*") || hasPermission("*");

  const [entries, setEntries] = useState<CorsOriginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newOrigin, setNewOrigin] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const activeCount = useMemo(
    () => entries.filter((entry) => entry.enabled).length,
    [entries],
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCorsSettings();
      setEntries(parseCorsOrigins(data.origins));
    } catch {
      showError(t("system.cors.toasts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const persistEntries = async (nextEntries: CorsOriginEntry[]) => {
    setSaving(true);
    try {
      const data = await setCorsSettings({ origins: nextEntries });
      setEntries(parseCorsOrigins(data.origins));
      showSuccess(t("system.cors.toasts.saved"));
    } catch {
      showError(t("system.cors.toasts.saveFailed"));
      throw new Error("save failed");
    } finally {
      setSaving(false);
    }
  };

  const hasDuplicate = (value: string, excludeIndex?: number) => {
    const normalized = normalizeOrigin(value);
    return entries.some(
      (entry, index) => index !== excludeIndex && entry.origin === normalized,
    );
  };

  const handleAdd = async () => {
    const value = normalizeOrigin(newOrigin);
    if (!isValidOrigin(value)) {
      setInputError(t("system.cors.validation.invalid"));
      return;
    }
    if (hasDuplicate(value)) {
      showWarning(t("system.cors.validation.duplicate"));
      return;
    }

    setInputError(null);
    try {
      await persistEntries([...entries, { origin: value, enabled: true }]);
      setNewOrigin("");
    } catch {
      /* toast already shown */
    }
  };

  const handleToggle = async (index: number, enabled: boolean) => {
    const next = entries.map((entry, i) => (i === index ? { ...entry, enabled } : entry));
    try {
      await persistEntries(next);
    } catch {
      /* toast already shown */
    }
  };

  const handleEditSave = async () => {
    if (editingIndex === null) return;
    const value = normalizeOrigin(editingValue);
    if (!isValidOrigin(value)) {
      setEditError(t("system.cors.validation.invalid"));
      return;
    }
    if (hasDuplicate(value, editingIndex)) {
      showWarning(t("system.cors.validation.duplicate"));
      return;
    }

    setEditError(null);
    const next = entries.map((entry, i) =>
      i === editingIndex ? { ...entry, origin: value } : entry,
    );
    try {
      await persistEntries(next);
      setEditingIndex(null);
      setEditingValue("");
    } catch {
      /* toast already shown */
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteIndex === null) return;
    const next = entries.filter((_, index) => index !== deleteIndex);
    setDeleteIndex(null);
    try {
      await persistEntries(next);
    } catch {
      /* toast already shown */
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Globe className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>{t("system.cors.card.title")}</CardTitle>
              <CardDescription>{t("system.cors.card.description")}</CardDescription>
            </div>
          </div>
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Badge variant="secondary" className="shrink-0">
              {t("system.cors.list.count", {
                active: activeCount,
                total: entries.length,
              })}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="min-w-0 max-w-full space-y-4">
        {!canManage && (
          <p className="text-xs text-muted-foreground">{t("system.cors.readOnly")}</p>
        )}

        {canManage && (
          <div className="space-y-2">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <Input
                value={newOrigin}
                onChange={(e) => {
                  setNewOrigin(e.target.value);
                  setInputError(null);
                }}
                placeholder={t("system.cors.input.placeholder")}
                disabled={saving || loading}
                className="min-w-0 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAdd();
                }}
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                onClick={() => void handleAdd()}
                disabled={saving || loading}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("system.cors.input.add")}
              </Button>
            </div>
            {inputError && <p className="text-xs text-destructive">{inputError}</p>}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {!loading && entries.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("system.cors.list.empty")}
          </p>
        ) : null}
        {!loading && entries.length > 0 ? (
          <ul className="min-w-0 max-w-full space-y-2">
            {entries.map((entry, index) => (
              <li
                key={`${entry.origin}-${index}`}
                className={cn(
                  "flex min-w-0 items-center gap-3 rounded-lg border p-3 transition-opacity",
                  !entry.enabled && "bg-muted/30 opacity-70",
                )}
              >
                {editingIndex === index && canManage ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={editingValue}
                      onChange={(e) => {
                        setEditingValue(e.target.value);
                        setEditError(null);
                      }}
                      className="min-w-0 font-mono text-sm"
                      disabled={saving}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleEditSave();
                        if (e.key === "Escape") {
                          setEditingIndex(null);
                          setEditingValue("");
                          setEditError(null);
                        }
                      }}
                    />
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleEditSave()}
                        disabled={saving}
                      >
                        {t("system.cors.actions.save")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingIndex(null);
                          setEditingValue("");
                          setEditError(null);
                        }}
                        disabled={saving}
                      >
                        {t("system.cors.actions.cancel")}
                      </Button>
                    </div>
                    {editError && <p className="text-xs text-destructive sm:w-full">{editError}</p>}
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code
                              className={cn(
                                "min-w-0 truncate font-mono text-sm",
                                !entry.enabled && "text-muted-foreground line-through",
                              )}
                            >
                              {entry.origin}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm break-all font-mono text-xs">
                            {entry.origin}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Badge variant={entry.enabled ? "default" : "secondary"} className="w-fit shrink-0">
                        {entry.enabled
                          ? t("system.cors.status.active")
                          : t("system.cors.status.inactive")}
                      </Badge>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {canManage && (
                        <>
                          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
                            <Switch
                              id={`cors-origin-${index}`}
                              checked={entry.enabled}
                              disabled={saving}
                              onCheckedChange={(checked) => void handleToggle(index, checked)}
                            />
                            <Label
                              htmlFor={`cors-origin-${index}`}
                              className="cursor-pointer text-xs text-muted-foreground"
                            >
                              {entry.enabled
                                ? t("system.cors.status.active")
                                : t("system.cors.status.inactive")}
                            </Label>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={saving}
                            onClick={() => {
                              setEditingIndex(index);
                              setEditingValue(entry.origin);
                              setEditError(null);
                            }}
                            aria-label={t("system.cors.actions.edit")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={saving}
                            onClick={() => setDeleteIndex(index)}
                            aria-label={t("system.cors.actions.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("system.cors.dialog.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("system.cors.dialog.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon("actionCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving}
              onClick={() => void handleDeleteConfirm()}
            >
              {t("system.cors.dialog.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
