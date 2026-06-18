import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useModuleTranslation } from "@/modules/localization";
import { showSuccess, showWarning } from "@/lib/notifications";
import {
  formatIntegrationRestSpecForCopy,
  isIntegrationRestSpec,
  type IntegrationRestSpec,
} from "../constants/agent-integration-rest";

interface WidgetRestApiPanelProps {
  /** Single integration endpoint spec (current API). */
  spec?: IntegrationRestSpec;
  /** @deprecated Use `spec` — kept for HMR / older callers that passed an array. */
  specs?: IntegrationRestSpec[];
}

function resolveRestSpec(props: WidgetRestApiPanelProps): IntegrationRestSpec | null {
  if (props.spec && isIntegrationRestSpec(props.spec)) {
    return props.spec;
  }
  const fromList = props.specs?.find(isIntegrationRestSpec);
  return fromList ?? null;
}

export function WidgetRestApiPanel(props: WidgetRestApiPanelProps) {
  const { t } = useModuleTranslation("agent");
  const [copied, setCopied] = useState(false);
  const spec = resolveRestSpec(props);

  if (!spec) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatIntegrationRestSpecForCopy(spec));
      setCopied(true);
      showSuccess(t("createEdit.fields.deploymentSnippetCopied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showWarning(t("createEdit.fields.deploymentCopyFailed"));
    }
  };

  return (
    <div className="grid min-w-0 max-w-full gap-2">
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handleCopy()}>
          {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {t("createEdit.actions.copyDeploymentSnippet")}
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{t("createEdit.fields.deploymentRestTitle")}</span>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {spec.method}
          </Badge>
        </div>

        <div className="grid gap-0 divide-y text-xs">
          <Field label={t("createEdit.fields.deploymentRestUrl")} mono>
            {spec.url}
          </Field>
          <Field label={t("createEdit.fields.deploymentRestHeaders")}>
            <ul className="space-y-1 font-mono">
              {spec.headers.map((row) => (
                <li key={row.key}>
                  <span className="text-muted-foreground">{row.key}:</span> {row.value}
                </li>
              ))}
            </ul>
          </Field>
          <Field label={t("createEdit.fields.deploymentRestBody")} mono pre>
            {spec.body}
          </Field>
          <Field label={t("createEdit.fields.deploymentRestResponse")}>
            <p className="mb-1.5 font-mono text-muted-foreground">
              {t("createEdit.fields.deploymentRestStatus", { code: spec.responseStatus })}
            </p>
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all">{spec.responseBody}</pre>
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  mono,
  pre,
}: Readonly<{ label: string; children: ReactNode; mono?: boolean; pre?: boolean }>) {
  return (
    <div className="px-3 py-2.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={cn(mono && "font-mono break-all", pre && "whitespace-pre-wrap")}>{children}</div>
    </div>
  );
}
