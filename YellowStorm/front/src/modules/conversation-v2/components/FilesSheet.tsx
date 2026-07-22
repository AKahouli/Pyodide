import { useEffect, useMemo, useState } from 'react';
import { FileText, FileIcon, LayoutGrid, List as ListIcon, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
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
import { ButtonGroup } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';
import { apiClient, ApiResponse } from '@/lib/api';
import { formatFileSize, getFileTypeLabel } from '@/modules/workspace/utils';
import {
  openFileViewerFromUrl,
  getMimeTypeFromFilename,
  useFileViewerStore,
} from '@/modules/file-viewer';
import { conversationV2Api } from '../api';
import { useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';

type ViewMode = 'list' | 'grid';
const VIEW_MODE_STORAGE_KEY = 'conversation-v2/files-sheet-view-mode';

function readStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'list';
  const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  return v === 'grid' || v === 'list' ? v : 'list';
}

interface WorkspaceDocumentRow {
  id: string;
  originalName: string;
  mimeType: string;
  path: string;
  size: number;
  createdAt: string;
}

interface DocumentsResponse {
  documents: WorkspaceDocumentRow[];
}

export function FilesSheet({ readOnly: _readOnly = false }: { readOnly?: boolean }) {
  const { t } = useConversationV2Translation();
  const { systemWorkspaceId, events, open, setOpen } = useConversationV2Store(
    useShallow((s) => ({
      systemWorkspaceId: s.systemWorkspaceId,
      events: s.events,
      open: s.filesSheetOpen,
      setOpen: s.setFilesSheetOpen,
    })),
  );

  // Refresh whenever the count of assistant attachments changes — cheap
  // heuristic that catches AI-generated artifacts as they arrive.
  const attachmentCount = useMemo(
    () =>
      events.reduce((acc, e) => {
        if (e.type === 'message' && e.role === 'assistant' && Array.isArray(e.attachments)) {
          return acc + e.attachments.length;
        }
        return acc;
      }, 0),
    [events],
  );

  const [items, setItems] = useState<WorkspaceDocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const closeFileViewer = useFileViewerStore((s) => s.closeViewer);

  const updateViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    }
  };

  useEffect(() => {
    if (!open || !systemWorkspaceId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiClient
      .get<ApiResponse<DocumentsResponse>>(`/workspaces/${systemWorkspaceId}/documents`)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data.data.documents ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, systemWorkspaceId, attachmentCount]);

  // AI-emitted artifacts often carry application/octet-stream because the AI
  // service doesn't set Content-Type. The badge label is much more useful when
  // derived from the filename (PDF, CSV, …) — fall back to the stored mime
  // only when the extension doesn't map to anything we know.
  const resolveMime = (doc: WorkspaceDocumentRow): string => {
    const fromName = getMimeTypeFromFilename(doc.originalName);
    if (fromName) return fromName;
    if (doc.mimeType && doc.mimeType !== 'application/octet-stream') return doc.mimeType;
    return doc.mimeType || 'application/octet-stream';
  };

  const openFile = async (doc: WorkspaceDocumentRow) => {
    try {
      const { url } = await conversationV2Api.getFileSignedUrl(doc.path);
      const mimeType =
        getMimeTypeFromFilename(doc.originalName) ?? doc.mimeType ?? 'application/octet-stream';
      closeFileViewer();
      openFileViewerFromUrl(url, doc.originalName, mimeType, { displayMode: 'floating' });
    } catch {
      /* swallow — surfaced via the file-viewer's own error state if needed */
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side='right' className='sm:max-w-lg w-full flex flex-col overflow-hidden'>
        <SheetHeader>
          <SheetTitle>{t('files.title')}</SheetTitle>
          <SheetDescription>
            {systemWorkspaceId ? '' : t('files.unavailable')}
          </SheetDescription>
        </SheetHeader>

        <div className='mt-4 flex items-center gap-2'>
          <FileText className='h-4 w-4 text-muted-foreground' />
          <span className='text-sm font-medium'>{t('files.title')}</span>
          {items.length > 0 && (
            <Badge variant='secondary' className='text-xs'>
              {items.length}
            </Badge>
          )}
          <ButtonGroup className='ml-auto'>
            <Button
              type='button'
              variant={viewMode === 'list' ? 'secondary' : 'outline'}
              size='icon-sm'
              aria-label={t('files.view.list')}
              aria-pressed={viewMode === 'list'}
              onClick={() => updateViewMode('list')}
            >
              <ListIcon className='h-4 w-4' />
            </Button>
            <Button
              type='button'
              variant={viewMode === 'grid' ? 'secondary' : 'outline'}
              size='icon-sm'
              aria-label={t('files.view.grid')}
              aria-pressed={viewMode === 'grid'}
              onClick={() => updateViewMode('grid')}
            >
              <LayoutGrid className='h-4 w-4' />
            </Button>
          </ButtonGroup>
        </div>

        <div className='flex-1 overflow-auto min-h-0 mt-3'>
          {!systemWorkspaceId ? (
            <div className='text-center py-12 text-sm text-muted-foreground'>
              {t('files.unavailable')}
            </div>
          ) : loading && items.length === 0 ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
            </div>
          ) : items.length === 0 ? (
            <div className='text-center py-12 text-sm text-muted-foreground'>
              {t('files.empty')}
            </div>
          ) : viewMode === 'list' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('workspace.sheet.table.name')}</TableHead>
                  <TableHead className='w-[80px]'>{t('workspace.sheet.table.size')}</TableHead>
                  <TableHead className='w-[70px]'>{t('workspace.sheet.table.type')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className='cursor-pointer hover:bg-accent/40'
                    onClick={() => openFile(doc)}
                  >
                    <TableCell className='max-w-[260px] truncate font-medium text-xs'>
                      {doc.originalName}
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {formatFileSize(doc.size)}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-[10px] px-1.5 py-0'>
                        {getFileTypeLabel(resolveMime(doc))}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
              {items.map((doc) => (
                <button
                  key={doc.id}
                  type='button'
                  onClick={() => openFile(doc)}
                  className={cn(
                    'group flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors',
                    'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <div className='flex w-full items-center justify-between'>
                    <FileIcon className='h-5 w-5 text-muted-foreground' />
                    <Badge variant='outline' className='text-[10px] px-1.5 py-0'>
                      {getFileTypeLabel(resolveMime(doc))}
                    </Badge>
                  </div>
                  <span className='line-clamp-2 break-all text-xs font-medium'>
                    {doc.originalName}
                  </span>
                  <span className='text-[10px] text-muted-foreground'>
                    {formatFileSize(doc.size)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
