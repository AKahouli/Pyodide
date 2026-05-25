import { Bot, MoreHorizontal, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { useModuleTranslation } from "@/modules/localization";

export function AgentButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('agent');
  const goToHub = () => navigate('/agents');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.agents')} onClick={goToHub}>
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
          <DropdownMenuItem onClick={goToHub} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            {t('button.manageAgents')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
