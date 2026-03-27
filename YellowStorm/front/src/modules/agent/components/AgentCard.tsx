import { Pencil, Trash2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Agent } from "../types";
import { useModuleTranslation } from "@/modules/localization";

interface AgentCardProps {
  agent: Agent;
  onEdit?: (agent: Agent) => void;
  onDelete?: (agent: Agent) => void;
}

export function AgentCard({ agent, onEdit, onDelete }: AgentCardProps) {
  const isReadOnly = agent.isDefault;
  const { t } = useModuleTranslation('agent');

  return (
    <div className="flex items-start justify-between rounded-lg border p-4 gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium truncate">{agent.name}</h4>
          <Badge variant="secondary" className="text-xs shrink-0">
            {agent.agentType?.name || t('card.unknownType')}
          </Badge>
          {agent.isDefaultForType && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
              {t('card.default')}
            </Badge>
          )}
          {isReadOnly && (
            <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
        </div>
        {agent.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {agent.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>{t('card.creativity')}{agent.temperature.toFixed(1)}</span>
          {agent.model && <span>{t('card.model')}{agent.model}</span>}
        </div>
      </div>

      {!isReadOnly && (
        <div className="flex gap-1 shrink-0">
          {onEdit && (
            <Button variant="ghost" size="icon" onClick={() => onEdit(agent)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="icon" onClick={() => onDelete(agent)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
