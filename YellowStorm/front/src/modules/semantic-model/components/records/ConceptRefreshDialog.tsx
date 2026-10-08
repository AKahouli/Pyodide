import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModuleTranslation } from "@/modules/localization";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conceptLabel: string;
  /** Starts the refresh; resolves once the run was accepted or refused. */
  onConfirm: (options: { rereadDocuments: boolean }) => Promise<void>;
}

/** Confirms a refresh of one concept, with the choice to call the AI again instead of reusing its earlier answers. */
export function ConceptRefreshDialog({ open, onOpenChange, conceptLabel, onConfirm }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const [forceAi, setForceAi] = useState(false);
  const [busy, setBusy] = useState(false);
  // A choice per refresh: it starts unticked every time.
  useEffect(() => { if (!open) setForceAi(false); }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm({ rereadDocuments: forceAi });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            {t("records.table.refreshTitle", { name: conceptLabel })}
          </DialogTitle>
          <DialogDescription>{t("records.table.refreshDescription")}</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3">
          <Checkbox className="mt-0.5" checked={forceAi} onCheckedChange={(checked) => setForceAi(checked === true)} disabled={busy} />
          <span>
            <span className="text-xs font-medium">{t("records.table.refreshForceAi")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("records.table.refreshForceAiHint")}</span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("action.cancel")}</Button>
          <Button onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {t("records.table.refreshConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
