import { useCallback, useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, ChevronRight, FileText, Library, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getWorkspaces } from '@/modules/workspace/api';
import { formatFileSize, getFileTypeLabel } from '@/modules/workspace/utils';
import type { Workspace } from '@/modules/workspace/types';
import { conversationV2Api } from '../api';
import { useConversationV2Translation } from '../translation';

const EMPTY_PAGINATION = { page: 1, limit: 10, total: 0, totalPages: 0 };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  workspaceIds: string[];
}

export function WorkspaceManagerSheet({ open, onOpenChange, sessionId, workspaceIds }: Props) {
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [documents, setDocuments] = useState<Array<Record<string, unknown>>>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const { t } = useConversationV2Translation();

  const fetchDocuments = useCallback(
    async (page: number) => {
      if (workspaceIds.length === 0) {
        setDocuments([]);
        setPagination(EMPTY_PAGINATION);
        setLoadingDocuments(false);
        return;
      }
      setLoadingDocuments(true);
      try {
        const result = await conversationV2Api.listWorkspaceDocuments(sessionId, { page, limit: 10 });
        setDocuments(result.documents);
        setPagination(result.pagination);
      } catch {
        toast.error(t('toasts.workspaces.loadDocumentsError'));
      } finally {
        setLoadingDocuments(false);
      }
    },
    [sessionId, workspaceIds, t],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setDocuments([]);
    setPagination(EMPTY_PAGINATION);
    setLoadingDocuments(true);
    setLoadingWorkspaces(true);

    const timer = setTimeout(() => {
      if (cancelled) return;
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
            toast.error(t('toasts.workspaces.loadListError'));
          }
        });
      fetchDocuments(1);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, fetchDocuments, t]);

  const getWorkspaceName = (wsId: string) =>
    allWorkspaces.find((w) => w.id === wsId)?.name ?? wsId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='sm:max-w-lg w-full flex flex-col overflow-hidden'>
        <SheetHeader>
          <SheetTitle>{t('workspace.sheet.title')}</SheetTitle>
          <SheetDescription>{t('workspace.sheet.description')}</SheetDescription>
        </SheetHeader>

        <div className='mt-4 flex flex-wrap items-center gap-2'>
          <Library className='h-4 w-4 text-muted-foreground' />
          {loadingWorkspaces ? (
            <span className='text-sm text-muted-foreground'>{t('workspace.sheet.loadingWorkspaces')}</span>
          ) : workspaceIds.length === 0 ? (
            <span className='text-sm text-muted-foreground'>{t('workspace.sheet.noSelection')}</span>
          ) : (
            <>
              <span className='text-sm font-medium'>
                {t('workspace.sheet.selectedCount', { count: workspaceIds.length })}
              </span>
              <div className='flex flex-wrap gap-1'>
                {workspaceIds.map((id) => (
                  <Badge key={id} variant='secondary' className='text-xs'>
                    {getWorkspaceName(id)}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        <Separator className='my-4' />

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
          ) : workspaceIds.length === 0 ? (
            <div className='text-center py-12 text-sm text-muted-foreground'>
              {t('workspace.sheet.noSelection')}
            </div>
          ) : documents.length === 0 ? (
            <div className='text-center py-12 text-sm text-muted-foreground'>
              {t('workspace.sheet.noDocuments')}
            </div>
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
                    <TableCell className='max-w-[180px] truncate font-medium text-xs'>
                      {doc.originalName as string}
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {formatFileSize(doc.size as number)}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-[10px] px-1.5 py-0'>
                        {getFileTypeLabel(doc.mimeType as string)}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground truncate max-w-[120px]'>
                      {getWorkspaceName(doc.workspaceId as string)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className='flex items-center justify-between pt-3 border-t mt-auto'>
            <span className='text-xs text-muted-foreground'>
              {t('workspace.sheet.paginationLabel', {
                page: pagination.page,
                total: pagination.totalPages,
              })}
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='icon'
                className='h-7 w-7'
                disabled={pagination.page <= 1 || loadingDocuments}
                onClick={() => fetchDocuments(pagination.page - 1)}
              >
                <ChevronLeft className='h-3.5 w-3.5' />
              </Button>
              <Button
                variant='outline'
                size='icon'
                className='h-7 w-7'
                disabled={pagination.page >= pagination.totalPages || loadingDocuments}
                onClick={() => fetchDocuments(pagination.page + 1)}
              >
                <ChevronRight className='h-3.5 w-3.5' />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
