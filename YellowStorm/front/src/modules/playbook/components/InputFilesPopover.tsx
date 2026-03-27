'use client';

import { useState } from 'react';
import { FolderOpen, FileText, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { InputFile } from '../types';
import { cn } from '@/lib/utils';

export function InputFilesPopover({
  files,
  onRemove,
}: {
  files: InputFile[];
  onRemove: (fileId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6',
              files.length > 0
                ? 'text-primary hover:text-primary'
                : 'text-muted-foreground hover:text-slate-700'
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
          {files.length > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 min-w-4 px-1 text-[9px] font-medium bg-primary text-primary-foreground rounded-full">
              {files.length}
            </span>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="top">
        <div className="px-3 py-2 border-b">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Input Files</span>
            <Badge variant="secondary" className="text-[10px]">
              {files.length} {files.length === 1 ? 'item' : 'items'}
            </Badge>
          </div>
        </div>

        <ScrollArea className={cn('max-h-[280px]', files.length === 0 && 'h-[100px]')}>
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-3 text-center">
              <FolderOpen className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                Drag workspaces or documents here
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {files.map((file) => (
                <div
                  key={`${file.type}-${file.id}`}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(file.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  {file.type === 'workspace' ? (
                    <FolderOpen className="h-4 w-4 text-sky-600 shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                  )}
                  <span className="text-xs truncate">{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {files.length > 0 && (
          <div className="p-2 border-t bg-muted/30">
            <p className="text-[10px] text-muted-foreground text-center">
              Drag workspaces or documents from the explorer to add more
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}