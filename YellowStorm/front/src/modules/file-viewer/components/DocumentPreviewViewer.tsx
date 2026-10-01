/**
 * Document Preview Viewer
 * The file viewer's renderers embedded in another screen, for one workspace document,
 * with page and highlight navigation driven by the host instead of the viewer store.
 */

import { Suspense, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileWarning, Loader2 } from 'lucide-react';
import type { PluginRegistry } from '@embedpdf/react-pdf-viewer';
import { apiClient, type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import { useModuleTranslation } from '@/modules/localization';
import type { DownloadUrlResponse } from '@/modules/workspace';
import { getRenderer } from '../renderers';
import { UnsupportedRenderer } from '../renderers/UnsupportedRenderer';
import type { FileTab, PendingNavigation } from '../types';

// A signed URL is re-signed a minute before it expires, like the file window does.
const URL_SAFETY_MARGIN_MS = 60_000;

export interface DocumentPreviewNavigation {
  page?: number;
  highlightText?: string;
  /** Changes on every request, so asking for the same place again scrolls back to it. */
  nonce: number;
}

export function DocumentPreviewViewer({ workspaceId, documentId, fileName, mimeType, navigation, onPageCount }: Readonly<{
  workspaceId: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  navigation?: DocumentPreviewNavigation | null;
  /** Told the number of pages, for the renderers that know it (PDF). */
  onPageCount?: (count: number) => void;
}>) {
  const { t } = useModuleTranslation('file-viewer');
  const registryRef = useRef<Map<string, PluginRegistry>>(new Map());
  const urlQuery = useQuery({
    queryKey: ['file-viewer', 'preview-url', workspaceId, documentId],
    queryFn: async () => (await apiClient.get<ApiResponse<DownloadUrlResponse>>(API_ENDPOINTS.workspaceDocuments.downloadUrl(workspaceId, documentId))).data.data,
    staleTime: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now() - URL_SAFETY_MARGIN_MS) : 0;
    },
    refetchOnWindowFocus: false,
  });
  const tabId = `preview:${workspaceId}:${documentId}`;
  const tab: FileTab | null = useMemo(() => urlQuery.data
    ? { id: tabId, workspaceId, documentId, fileName, mimeType, url: urlQuery.data.url, urlExpiresAt: urlQuery.data.expiresAt }
    : null, [tabId, workspaceId, documentId, fileName, mimeType, urlQuery.data]);
  const pending: PendingNavigation | null = useMemo(() => navigation
    ? { tabId, page: navigation.page, highlightText: navigation.highlightText }
    : null,
  // The nonce makes a new object for a repeated request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tabId, navigation?.nonce]);

  const loading = <div className='flex h-full flex-col items-center justify-center gap-3 text-muted-foreground' role='status'>
    <Loader2 className='h-6 w-6 animate-spin' />
    <p className='text-sm'>{t('loading')} {fileName}...</p>
  </div>;
  if (urlQuery.isError) {
    return <div role='alert' className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm'>
      <FileWarning className='h-6 w-6 text-destructive' />
      <p className='font-medium'>{t('store.openError.title')}</p>
      <p className='text-muted-foreground'>{t('store.openError.description')}</p>
    </div>;
  }
  if (!tab) return loading;
  const Renderer = getRenderer(mimeType);
  if (!Renderer) return <UnsupportedRenderer tab={tab} isActive />;
  return <Suspense fallback={loading}>
    <Renderer key={tab.id} tab={tab} isActive registryRef={registryRef} navigation={pending} onPageCount={onPageCount} />
  </Suspense>;
}
