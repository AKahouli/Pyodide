import { useMemo, useState } from "react";
import { Check, Code2, Copy, Info, Rocket, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { showSuccess, showWarning } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { buildWidgetSnippet } from "../constants/widget-template";

interface AgentDeploymentSectionProps {
  agentId: string | null;
}

interface IntegrationSnippetPanelProps {
  title: string;
  hint: string;
  copyLabel: string;
  copiedLabel: string;
  lines: string[];
  onCopy: () => void;
  isCopied: boolean;
}

export function AgentDeploymentSection({ agentId }: AgentDeploymentSectionProps) {
  const { t } = useModuleTranslation("agent");
  const [snippet, setSnippet] = useState("");
  const [isCopied, setIsCopied] = useState(false);

  const hasSnippet = useMemo(() => snippet.trim().length > 0, [snippet]);
  const codeLines = useMemo(() => (hasSnippet ? snippet.split("\n") : []), [snippet, hasSnippet]);

  const handleGenerate = () => {
    if (!agentId) {
      showWarning(t("createEdit.fields.deploymentRequiresAgent"));
      return;
    }
    setSnippet(buildWidgetSnippet(agentId));
    setIsCopied(false);
    showSuccess(t("createEdit.fields.deploymentGenerated"));
  };

  const handleCopySnippet = async () => {
    if (!hasSnippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setIsCopied(true);
      showSuccess(t("createEdit.fields.deploymentSnippetCopied"));
      window.setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showWarning(t("createEdit.fields.deploymentCopyFailed"));
    }
  };

  return (
    <div className="min-w-0 max-w-full space-y-3 rounded-xl border bg-card/80 p-3 shadow-sm backdrop-blur-sm sm:p-4">
      <div className="space-y-1.5">
        <Label className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Rocket className="h-3.5 w-3.5 text-primary" />
          </span>
          {t("createEdit.fields.deployment")}
        </Label>
        <p className="pl-9 text-xs leading-relaxed text-muted-foreground">
          {t("createEdit.fields.deploymentDescription")}
        </p>
      </div>

      {!agentId ? (
        <p className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          {t("createEdit.fields.deploymentRequiresAgent")}
        </p>
      ) : (
        <Button type="button" size="sm" className="shadow-sm" onClick={handleGenerate}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {t("createEdit.actions.generateDeploymentSnippet")}
        </Button>
      )}

      {hasSnippet && (
        <IntegrationSnippetPanel
          title={t("createEdit.fields.deploymentSnippet")}
          hint={t("createEdit.fields.deploymentSnippetHint")}
          copyLabel={t("createEdit.actions.copyDeploymentSnippet")}
          copiedLabel={t("createEdit.actions.deploymentSnippetCopiedShort")}
          lines={codeLines}
          isCopied={isCopied}
          onCopy={handleCopySnippet}
        />
      )}
    </div>
  );
}

function IntegrationSnippetPanel({
  title,
  hint,
  copyLabel,
  copiedLabel,
  lines,
  onCopy,
  isCopied,
}: Readonly<IntegrationSnippetPanelProps>) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-xl border border-zinc-800/80 shadow-md",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-white/[0.06] bg-zinc-900 px-3 py-2.5">
        <div className="flex shrink-0 items-center gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-[#ff5f57]" />
          <span className="size-2 rounded-full bg-[#febc2e]" />
          <span className="size-2 rounded-full bg-[#28c840]" />
        </div>
        <Code2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">{title}</p>
        <span className="hidden shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:inline">
          HTML
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 shrink-0 gap-1.5 border border-transparent px-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white",
            isCopied && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300",
          )}
          onClick={onCopy}
        >
          {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {isCopied ? copiedLabel : copyLabel}
        </Button>
      </div>

      <ScrollArea className="h-[min(260px,34vh)] w-full max-w-full bg-[#0d1117]">
        <div className="flex min-w-0 max-w-full">
          <div
            aria-hidden
            className="sticky left-0 shrink-0 select-none border-r border-white/[0.06] bg-[#161b22] px-2.5 py-3 font-mono text-[10px] leading-[1.7] text-zinc-600 sm:px-3 sm:text-[11px]"
          >
            {lines.map((_, index) => (
              <div key={`line-num-${index + 1}`}>{index + 1}</div>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto py-3 pr-4 pl-2.5 sm:pl-3">
            <pre className="font-mono text-[10px] leading-[1.7] sm:text-[11px]">
              <code>
                {lines.map((line, index) => (
                  <SnippetCodeLine key={`line-code-${index + 1}`} line={line} />
                ))}
              </code>
            </pre>
          </div>
        </div>
      </ScrollArea>

      <div className="flex gap-2 border-t border-white/[0.06] bg-zinc-900/95 px-3 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <p className="text-[11px] leading-relaxed text-zinc-500">{hint}</p>
      </div>
    </div>
  );
}

function SnippetCodeLine({ line }: Readonly<{ line: string }>) {
  if (line.length === 0) {
    return <div>{"\u00a0"}</div>;
  }

  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
    return <div className="text-zinc-600">{line}</div>;
  }

  if (line.includes("<script") || line.includes("</script>")) {
    return <div className="text-rose-300/90">{line}</div>;
  }

  if (line.includes('"') || line.includes("'")) {
    return <div className="text-emerald-400/85">{line}</div>;
  }

  const upper = line.toUpperCase();
  if (
    upper.includes("FUNCTION") ||
    upper.includes("VAR ") ||
    upper.includes("RETURN ") ||
    upper.includes("ASYNC ")
  ) {
    return <div className="text-sky-400/90">{line}</div>;
  }

  return <div className="text-zinc-300">{line}</div>;
}
