import { Check, Code2, Copy, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface IntegrationSnippetPanelProps {
  title: string;
  hint: string;
  badge: string;
  copyLabel: string;
  copiedLabel: string;
  lines: string[];
  onCopy: () => void;
  isCopied: boolean;
  /** Compact layout for short snippets (default: auto when ≤ 2 lines). */
  compact?: boolean;
}

export function IntegrationSnippetPanel({
  title,
  hint,
  badge,
  copyLabel,
  copiedLabel,
  lines,
  onCopy,
  isCopied,
  compact,
}: Readonly<IntegrationSnippetPanelProps>) {
  const isCompact = compact ?? lines.length <= 2;

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-zinc-800/80 shadow-md">
      <div className="flex min-w-0 items-center gap-2 border-b border-white/[0.06] bg-zinc-900 px-3 py-2.5">
        <div className="flex shrink-0 items-center gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-[#ff5f57]" />
          <span className="size-2 rounded-full bg-[#febc2e]" />
          <span className="size-2 rounded-full bg-[#28c840]" />
        </div>
        <Code2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">{title}</p>
        <span className="hidden shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:inline">
          {badge}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 shrink-0 gap-1.5 px-2.5 text-xs text-zinc-300",
            isCopied && "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
          )}
          onClick={onCopy}
        >
          {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {isCopied ? copiedLabel : copyLabel}
        </Button>
      </div>
      {isCompact ? (
        <div className="min-w-0 max-w-full overflow-x-auto bg-[#0d1117]">
          <pre className="min-w-0 max-w-full whitespace-pre-wrap break-all px-3 py-3 font-mono text-xs leading-relaxed text-zinc-300 sm:text-[13px]">
            <code>{lines.join("\n")}</code>
          </pre>
        </div>
      ) : (
        <ScrollArea className="h-[min(260px,34vh)] min-w-0 max-w-full bg-[#0d1117]">
          <pre className="min-w-0 max-w-full whitespace-pre-wrap break-all p-3 font-mono text-[10px] leading-relaxed text-zinc-300">
            <code>{lines.join("\n")}</code>
          </pre>
        </ScrollArea>
      )}
      <div className="flex gap-2 border-t border-white/[0.06] bg-zinc-900/95 px-3 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <p className="text-[11px] text-zinc-500">{hint}</p>
      </div>
    </div>
  );
}
