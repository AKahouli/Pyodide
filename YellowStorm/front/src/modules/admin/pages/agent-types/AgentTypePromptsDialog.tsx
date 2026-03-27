import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Minus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useModelsStore,
  useModels,
  useModelsInitialized,
} from "@/modules/models";

import {
  getAgentTypePrompts,
  upsertAgentTypePrompt,
  deleteAgentTypePrompt,
} from "../../api";
import type { AgentTypeResponse, AgentTypePromptResponse } from "../../types";
import { useModuleTranslation } from "@/modules/localization";

interface AgentTypePromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentType: AgentTypeResponse | null;
}

export function AgentTypePromptsDialog({
  open,
  onOpenChange,
  agentType,
}: AgentTypePromptsDialogProps) {
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const models = useModels();
  const modelsInitialized = useModelsInitialized();
  const fetchModels = useModelsStore((s) => s.fetchModels);

  const [prompts, setPrompts] = useState<Map<string, AgentTypePromptResponse>>(new Map());
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const activeModels = models.filter((m) => m.isActive);

  const loadPrompts = useCallback(async () => {
    if (!agentType) return;
    setLoading(true);
    try {
      const data = await getAgentTypePrompts(agentType.id);
      const map = new Map<string, AgentTypePromptResponse>();
      for (const p of data) {
        map.set(p.modelId, p);
      }
      setPrompts(map);
    } catch (err) {
      toast.error(t("agentTypes.prompts.toasts.errors.load"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    } finally {
      setLoading(false);
    }
  }, [agentType]);

  useEffect(() => {
    if (open && agentType) {
      loadPrompts();
      setSelectedModelId(null);
      setCurrentText("");
      if (!modelsInitialized) {
        fetchModels();
      }
    }
  }, [open, agentType, loadPrompts, modelsInitialized, fetchModels]);

  useEffect(() => {
    if (selectedModelId) {
      const existing = prompts.get(selectedModelId);
      setCurrentText(existing?.prompt ?? "");
    }
  }, [selectedModelId, prompts]);

  const selectedModel = activeModels.find((m) => m.name === selectedModelId);
  const hasExistingPrompt = selectedModelId ? prompts.has(selectedModelId) : false;

  const handleSave = async () => {
    if (!agentType || !selectedModelId) return;
    setSaving(true);
    try {
      const result = await upsertAgentTypePrompt(agentType.id, selectedModelId, {
        prompt: currentText,
      });
      setPrompts((prev) => {
        const next = new Map(prev);
        next.set(selectedModelId, result);
        return next;
      });
      toast.success(t("agentTypes.prompts.toasts.saved.title"), {
        description: t("agentTypes.prompts.toasts.saved.description", { model: selectedModelId }),
      });
    } catch (err) {
      toast.error(t("agentTypes.prompts.toasts.errors.save"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agentType || !selectedModelId) return;
    setSaving(true);
    try {
      await deleteAgentTypePrompt(agentType.id, selectedModelId);
      setPrompts((prev) => {
        const next = new Map(prev);
        next.delete(selectedModelId);
        return next;
      });
      setCurrentText("");
      toast.success(t("agentTypes.prompts.toasts.deleted.title"), {
        description: t("agentTypes.prompts.toasts.deleted.description", { model: selectedModelId }),
      });
    } catch (err) {
      toast.error(t("agentTypes.prompts.toasts.errors.delete"), {
        description: err instanceof Error ? err.message : tCommon("errorUnknown"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyFromDefault = () => {
    if (agentType) {
      setCurrentText(agentType.defaultPrompt || "");
    }
  };

  if (!agentType) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("agentTypes.prompts.title", { name: agentType.name })}</DialogTitle>
          <DialogDescription>
            {t("agentTypes.prompts.description")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex gap-4 min-h-0 flex-1 overflow-hidden">
            {/* Left panel - model list */}
            <div className="w-64 shrink-0 flex flex-col min-h-0">
              <p className="text-sm font-medium mb-2">{t("agentTypes.prompts.models.title")}</p>
              <ScrollArea className="flex-1 border rounded-md">
                <div className="p-1">
                    {activeModels.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-3">
                        {t("agentTypes.prompts.models.empty")}
                      </p>
                  ) : (
                    activeModels.map((model) => {
                      const hasPrompt = prompts.has(model.name);
                      const isSelected = selectedModelId === model.name;
                      return (
                        <button
                          key={model.id}
                          onClick={() => setSelectedModelId(model.name)}
                          className={`w-full text-left px-3 py-2 rounded-sm text-sm flex items-center gap-2 transition-colors ${
                            isSelected
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          <span className="flex-1 truncate">{model.name}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px] px-1">
                            {model.chef}
                          </Badge>
                          {hasPrompt ? (
                            <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          ) : (
                            <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right panel - prompt editor */}
            <div className="flex-1 flex flex-col min-h-0">
              {selectedModelId ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium">{selectedModelId}</p>
                    {selectedModel && (
                      <Badge variant="outline" className="text-xs">
                        {selectedModel.chef}
                      </Badge>
                    )}
                    {hasExistingPrompt && (
                      <Badge variant="secondary" className="text-xs">
                        {t("agentTypes.prompts.indicators.custom")}
                      </Badge>
                    )}
                  </div>
                  <Textarea
                    value={currentText}
                    onChange={(e) => setCurrentText(e.target.value)}
                    placeholder={t("agentTypes.prompts.editor.placeholder")}
                    className="flex-1 min-h-[200px] resize-none font-mono text-sm"
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <Button onClick={handleSave} disabled={saving} size="sm">
                      {saving ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-3.5 w-3.5" />
                      )}
                      {t("agentTypes.prompts.actions.save")}
                    </Button>
                    {hasExistingPrompt && (
                      <Button
                        onClick={handleDelete}
                        disabled={saving}
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        {t("agentTypes.prompts.actions.delete")}
                      </Button>
                    )}
                    <Button
                      onClick={handleCopyFromDefault}
                      disabled={saving}
                      variant="outline"
                      size="sm"
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      {t("agentTypes.prompts.actions.copyDefault")}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  {t("agentTypes.prompts.editor.emptyState")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Default prompt summary */}
        <Separator className="my-2" />
        <div className="shrink-0">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {t("agentTypes.prompts.default.title")}
          </p>
          <div className="max-h-20 overflow-y-auto rounded border bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
              {agentType.defaultPrompt || t("agentTypes.prompts.default.empty")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
