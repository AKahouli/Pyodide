import { useState } from "react";
import { Bot, MoreHorizontal, Plus } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentDialog } from "./AgentDialog";
import { useModuleTranslation } from "@/modules/localization";

export function AgentButton() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { t } = useModuleTranslation('agent');

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={t('button.agents')} onClick={() => setDialogOpen(true)}>
          <Bot />
          <span>{t('button.agents')}</span>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover>
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onClick={() => setDialogOpen(true)} className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              {t('button.manageAgents')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <AgentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
