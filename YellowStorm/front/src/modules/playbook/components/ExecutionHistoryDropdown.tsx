import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { useExecutionHistory, useCurrentExecution, useCurrentPlaybook } from '../store';
import { formatPlaybookDateTime } from '../utils/formatPlaybookDateTime';
import { useModuleTranslation } from '@/modules/localization';

export function ExecutionHistoryDropdown() {
  const navigate = useNavigate();
  const { id, executionId } = useParams<{ id: string; executionId: string }>();
  const history = useExecutionHistory();
  const current = useCurrentExecution();
  const playbook = useCurrentPlaybook();
  const { t } = useModuleTranslation('playbook');
  const scheduleTz = playbook?.executionSchedule?.timezone;

  if (history.length === 0 && !current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {t('execution.run')} #{current?.executionNumber || '?'}
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-0">
        <ScrollArea className="h-72">
          <div className="p-1">
            {history.map((exec) => (
              <DropdownMenuItem
                key={exec.id}
                className={`cursor-pointer ${exec.id === executionId ? 'bg-accent' : ''}`}
                onClick={() => navigate(`/playbooks/${id}/executions/${exec.id}`)}
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="min-w-0">
                    <span className="text-sm">#{exec.executionNumber}</span>
                    <span className="text-[10px] uppercase text-muted-foreground ml-1.5">
                      {exec.executionTrigger === 'scheduled'
                        ? t('execution.trigger.scheduled')
                        : t('execution.trigger.manual')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PlaybookStatusBadge status={exec.status} size="sm" />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatPlaybookDateTime(exec.createdAt, { timeZone: scheduleTz })}
                    </span>
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
