import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentList } from "./AgentList";
import { useModuleTranslation } from "@/modules/localization";

interface AgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentDialog({ open, onOpenChange }: AgentDialogProps) {
  const { t } = useModuleTranslation('agent');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('dialog.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <AgentList />
        </div>
      </DialogContent>
    </Dialog>
  );
}
