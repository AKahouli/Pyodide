import { Info } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function EvaluationDefinitionTooltip({
  label,
  definition,
  className,
}: Readonly<{
  label: string;
  definition: string;
  className?: string;
}>) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${label}: ${definition}`}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 leading-relaxed" side="top">
          {definition}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
