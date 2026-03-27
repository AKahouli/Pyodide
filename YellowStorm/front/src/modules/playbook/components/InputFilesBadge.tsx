'use client';

import { FolderOpen, FileText, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { InputFile } from '../types';
import { cn } from '@/lib/utils';

interface InputFilesBadgeProps {
  files: InputFile[];
  onRemove?: (fileId: string) => void;
  compact?: boolean;
}

export function InputFilesBadge({ files, onRemove, compact = false }: InputFilesBadgeProps) {
  if (files.length === 0) return null;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-sky-700 border-sky-600/30">
              <FolderOpen className="h-2.5 w-2.5" />
              {files.length}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <div className="space-y-1">
            {files.map((file) => (
              <div key={`${file.type}-${file.id}`} className="flex items-center gap-1.5 text-xs">
                {file.type === 'workspace' ? (
                  <FolderOpen className="h-3 w-3 shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{file.name}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {files.map((file) => (
        <Badge
          key={`${file.type}-${file.id}`}
          variant="outline"
          className={cn(
            'text-[10px] px-1.5 py-0 h-4 gap-1',
            file.type === 'workspace'
              ? 'text-sky-700 border-sky-600/30'
              : 'text-emerald-700 border-emerald-600/30'
          )}
        >
          {file.type === 'workspace' ? (
            <FolderOpen className="h-2.5 w-2.5" />
          ) : (
            <FileText className="h-2.5 w-2.5" />
          )}
          <span className="truncate max-w-[80px]">{file.name}</span>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-3 w-3 p-0 ml-0.5 hover:bg-transparent"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(file.id);
              }}
            >
              <X className="h-2.5 w-2.5" />
            </Button>
          )}
        </Badge>
      ))}
    </div>
  );
}