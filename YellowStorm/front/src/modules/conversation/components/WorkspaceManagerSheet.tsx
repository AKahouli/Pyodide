import { useState, useEffect, useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from '@/components/ui/command';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Check, ChevronsUpDown, ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getWorkspaces } from '@/modules/workspace/api';
import { formatFileSize, getFileTypeLabel } from '@/modules/workspace/utils';
import type { Workspace } from '@/modules/workspace/types';
import { updateConversation, fetchConversationWorkspaceDocuments } from '../api';
import { useConversationStore } from '../store';
import { useModuleTranslation } from '@/modules/localization';

const EMPTY_PAGINATION = { page: 1, limit: 10, total: 0, totalPages: 0 };

interface WorkspaceManagerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  workspaceIds: string[];
}

export function WorkspaceManagerSheet({ open, onOpenChange, conversationId, workspaceIds }: WorkspaceManagerSheetProps) {
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(workspaceIds);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [documents, setDocuments] = useState<Array<Record<string, unknown>>>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [updatingWorkspaces, setUpdatingWorkspaces] = useState(false);

  const storeUpdateConversation = useConversationStore((s) => s.updateConversation);
  const { t } = useModuleTranslation('conversation');

  // Ref to avoid putting selectedIds in callback deps
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Sync selected IDs when prop changes
  useEffect(() => {
    setSelectedIds(workspaceIds);
  }, [workspaceIds]);

  // Stable fetch function — only depends on conversationId
  const fetchDocuments = useCallback(
    async (page: number) => {
      if (selectedIdsRef.current.length === 0) {
        setDocuments([]);
        setPagination(EMPTY_PAGINATION);
        setLoadingDocuments(false);
        return;
      }

      setLoadingDocuments(true);
      try {
        const result = await fetchConversationWorkspaceDocuments(conversationId, { page, limit: 10 });
        setDocuments(result.documents);
        setPagination(result.pagination);
      } catch {
        toast.error(t('toasts.workspace.loadDocumentsError'));
      } finally {
        setLoadingDocuments(false);
      }
    },
    [conversationId],
  );

  // Fetch data when sheet opens — deferred to avoid janking the animation
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    // Clear stale data and show loading immediately
    setDocuments([]);
    setPagination(EMPTY_PAGINATION);
    setLoadingDocuments(true);
    setLoadingWorkspaces(true);

    const timer = setTimeout(() => {
      if (cancelled) return;

      // Fetch workspaces
      getWorkspaces({ limit: 100 })
        .then((result) => {
          if (!cancelled) {
            setAllWorkspaces(result.workspaces);
            setLoadingWorkspaces(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadingWorkspaces(false);
            toast.error(t('toasts.workspace.loadListError'));
          }
        });

      // Fetch documents
      fetchDocuments(1);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, fetchDocuments]);

  const handleToggleWorkspace = async (workspaceId: string) => {
    const isSelected = selectedIds.includes(workspaceId);
    const newIds = isSelected ? selectedIds.filter((id) => id !== workspaceId) : [...selectedIds, workspaceId];

    setUpdatingWorkspaces(true);
    try {
      await updateConversation(conversationId, { workspaces: newIds });
      setSelectedIds(newIds);
      selectedIdsRef.current = newIds;
      storeUpdateConversation(conversationId, { workspaces: newIds });

      // Refetch documents after workspace change
      if (newIds.length === 0) {
        setDocuments([]);
        setPagination(EMPTY_PAGINATION);
      } else {
        await fetchDocuments(1);
      }
    } catch {
      toast.error(t('toasts.workspace.updateError'));
    } finally {
      setUpdatingWorkspaces(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    fetchDocuments(newPage);
  };

  const getWorkspaceName = (wsId: string) => {
    return allWorkspaces.find((w) => w.id === wsId)?.name || wsId;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='sm:max-w-lg w-full flex flex-col overflow-hidden'>
        <SheetHeader>
          <SheetTitle>{t('workspace.sheet.title')}</SheetTitle>
          <SheetDescription>{t('workspace.sheet.description')}</SheetDescription>
        </SheetHeader>

        {/* Workspace Multi-Select */}
        <div className='mt-4'>
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant='outline' role='combobox' aria-expanded={popoverOpen} className='w-full justify-between' disabled={loadingWorkspaces}>
                {loadingWorkspaces ? t('workspace.sheet.loadingWorkspaces') : selectedIds.length === 0 ? t('workspace.sheet.selectPlaceholder') : t('workspace.sheet.selectedCount', { count: selectedIds.length })}
                <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[--radix-popover-trigger-width] p-0' align='start'>
              <Command>
                <CommandInput placeholder={t('workspace.sheet.searchPlaceholder')} />
                <CommandList>
                  <CommandEmpty>{t('workspace.sheet.searchEmpty')}</CommandEmpty>
                  <CommandGroup>
                    {allWorkspaces.map((workspace) => (
                      <CommandItem key={workspace.id} value={workspace.name} onSelect={() => handleToggleWorkspace(workspace.id)} disabled={updatingWorkspaces}>
                        <Check className={cn('mr-2 h-4 w-4', selectedIds.includes(workspace.id) ? 'opacity-100' : 'opacity-0')} />
                        <span className='truncate'>{workspace.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <Separator className='my-4' />

        {/* Documents Section */}
        <div className='flex items-center gap-2 mb-3'>
          <FileText className='h-4 w-4 text-muted-foreground' />
          <span className='text-sm font-medium'>{t('workspace.sheet.documentsLabel')}</span>
          {pagination.total > 0 && (
            <Badge variant='secondary' className='text-xs'>
              {pagination.total}
            </Badge>
          )}
        </div>

        <div className='flex-1 overflow-auto min-h-0'>
          {loadingDocuments ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
            </div>
          ) : selectedIds.length === 0 ? (
            <div className='text-center py-12 text-sm text-muted-foreground'>{t('workspace.sheet.noSelection')}</div>
          ) : documents.length === 0 ? (
            <div className='text-center py-12 text-sm text-muted-foreground'>{t('workspace.sheet.noDocuments')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('workspace.sheet.table.name')}</TableHead>
                  <TableHead className='w-[70px]'>{t('workspace.sheet.table.size')}</TableHead>
                  <TableHead className='w-[60px]'>{t('workspace.sheet.table.type')}</TableHead>
                  <TableHead className='w-[120px]'>{t('workspace.sheet.table.workspace')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id as string}>
                    <TableCell className='max-w-[180px] truncate font-medium text-xs'>{doc.originalName as string}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{formatFileSize(doc.size as number)}</TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-[10px] px-1.5 py-0'>
                        {getFileTypeLabel(doc.mimeType as string)}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground truncate max-w-[120px]'>{getWorkspaceName(doc.workspaceId as string)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className='flex items-center justify-between pt-3 border-t mt-auto'>
            <span className='text-xs text-muted-foreground'>{t('workspace.sheet.paginationLabel', { page: pagination.page, total: pagination.totalPages })}</span>
            <div className='flex items-center gap-1'>
              <Button variant='outline' size='icon' className='h-7 w-7' disabled={pagination.page <= 1 || loadingDocuments} onClick={() => handlePageChange(pagination.page - 1)}>
                <ChevronLeft className='h-3.5 w-3.5' />
              </Button>
              <Button variant='outline' size='icon' className='h-7 w-7' disabled={pagination.page >= pagination.totalPages || loadingDocuments} onClick={() => handlePageChange(pagination.page + 1)}>
                <ChevronRight className='h-3.5 w-3.5' />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
