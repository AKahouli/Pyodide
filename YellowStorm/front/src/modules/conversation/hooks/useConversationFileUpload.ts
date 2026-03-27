import { useState, useCallback, useRef, useEffect } from 'react';
import { requestFileUploadUrl, confirmFileUpload, deleteConversationFile } from '../api';
import { translateConversation } from '../translation';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

export type FileUploadStatus = 'uploading' | 'confirming' | 'completed' | 'failed';

export interface FileUploadItem {
  localId: string;
  file: File;
  status: FileUploadStatus;
  progress: number;
  documentId?: string;
  error?: string;
}

interface UseConversationFileUploadOptions {
  conversationId: string | null;
  createConversation?: () => Promise<{ id: string }>;
  onError?: (message: string) => void;
}

interface UseConversationFileUploadReturn {
  files: FileUploadItem[];
  addFiles: (rawFiles: File[], localIds: string[]) => void;
  removeFile: (localId: string) => void;
  completedFileIds: string[];
  isUploading: boolean;
  clearAll: () => void;
  conversationId: string | null;
}

export function useConversationFileUpload({ conversationId: externalConvId, createConversation, onError }: UseConversationFileUploadOptions): UseConversationFileUploadReturn {
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(null);

  const ERROR_UPLOAD_ABORTED = 'UPLOAD_ABORTED';
  const ERROR_UPLOAD_FAILED = 'UPLOAD_FAILED';
  const ERROR_UPLOAD_FAILED_STATUS = 'UPLOAD_FAILED_STATUS';

  // Mutex for conversation creation to prevent duplicates
  const convCreationPromiseRef = useRef<Promise<string> | null>(null);

  // Track abort controllers per file (localId -> AbortController/XMLHttpRequest)
  const xhrMapRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  // Track mounted state for async cleanup
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort all in-progress uploads on unmount
      for (const xhr of xhrMapRef.current.values()) {
        xhr.abort();
      }
      xhrMapRef.current.clear();
    };
  }, []);

  // Effective conversation ID (external takes priority, then resolved from creation)
  const effectiveConvId = externalConvId || resolvedConvId;

  // Sync resolvedConvId when externalConvId changes
  useEffect(() => {
    if (externalConvId) {
      setResolvedConvId(externalConvId);
    }
  }, [externalConvId]);

  /**
   * Ensure we have a conversation ID. If none exists, create one (with mutex).
   */
  const ensureConversationId = useCallback(async (): Promise<string> => {
    const current = externalConvId || resolvedConvId;
    if (current) return current;

    if (!createConversation) {
      throw new Error('No conversationId and no createConversation callback provided');
    }

    // Mutex: if creation is already in progress, wait for it
    if (convCreationPromiseRef.current) {
      return convCreationPromiseRef.current;
    }

    const promise = createConversation()
      .then((conv) => {
        if (mountedRef.current) {
          setResolvedConvId(conv.id);
        }
        convCreationPromiseRef.current = null;
        return conv.id;
      })
      .catch((err) => {
        convCreationPromiseRef.current = null;
        throw err;
      });

    convCreationPromiseRef.current = promise;
    return promise;
  }, [externalConvId, resolvedConvId, createConversation]);

  /**
   * Upload a single file: requestUploadUrl -> XHR PUT to Azure -> confirmFileUpload
   */
  const uploadFile = useCallback(
    async (localId: string, file: File, convId: string) => {
      try {
        // Step 1: Get presigned upload URL
        const { documentId, uploadUrl } = await requestFileUploadUrl(convId, {
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        });

        if (!mountedRef.current) return;

        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, documentId } : f)));

        // Step 2: Upload to Azure via XHR (for progress events)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrMapRef.current.set(localId, xhr);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && mountedRef.current) {
              const progress = Math.round((e.loaded / e.total) * 100);
              setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, progress } : f)));
            }
          };

          xhr.onload = () => {
            xhrMapRef.current.delete(localId);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              const error = new Error(ERROR_UPLOAD_FAILED_STATUS) as Error & { status?: number };
              error.status = xhr.status;
              reject(error);
            }
          };

          xhr.onerror = () => {
            xhrMapRef.current.delete(localId);
            reject(new Error(ERROR_UPLOAD_FAILED));
          };

          xhr.onabort = () => {
            xhrMapRef.current.delete(localId);
            reject(new Error(ERROR_UPLOAD_ABORTED));
          };

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.send(file);
        });

        if (!mountedRef.current) return;

        // Step 3: Confirm upload
        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: 'confirming' as const, progress: 100 } : f)));

        await confirmFileUpload(convId, documentId);

        if (!mountedRef.current) return;

        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: 'completed' as const } : f)));
      } catch (err: any) {
        if (!mountedRef.current) return;

        let notify = true;
        let translationKey: ModuleTranslationKey<'conversation'> | null = null;
        let translationParams: TranslationParams | undefined;
        if (err instanceof Error) {
          if (err.message === ERROR_UPLOAD_ABORTED) {
            notify = false;
            translationKey = 'upload.errors.aborted';
          } else if (err.message === ERROR_UPLOAD_FAILED_STATUS) {
            translationKey = 'upload.errors.http';
            translationParams = { status: (err as Error & { status?: number }).status ?? 0 };
          } else if (err.message === ERROR_UPLOAD_FAILED) {
            translationKey = 'upload.errors.generic';
          }
        }
        const translatedMessage = translationKey ? translateConversation(translationKey, translationParams) : err instanceof Error && err.message ? err.message : translateConversation('upload.errors.generic');

        setFiles((prev) => {
          const exists = prev.find((f) => f.localId === localId);
          if (!exists) return prev; // Already removed
          return prev.map((f) => (f.localId === localId ? { ...f, status: 'failed' as const, error: translatedMessage } : f));
        });

        if (notify) {
          onError?.(translatedMessage);
        }
      }
    },
    [onError],
  );

  const addFiles = useCallback(
    (rawFiles: File[], localIds: string[]) => {
      if (rawFiles.length === 0) return;

      // Create initial file entries
      const newItems: FileUploadItem[] = rawFiles.map((file, i) => ({
        localId: localIds[i],
        file,
        status: 'uploading' as const,
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...newItems]);

      // Start uploads asynchronously
      (async () => {
        try {
          const convId = await ensureConversationId();

          for (let i = 0; i < rawFiles.length; i++) {
            uploadFile(localIds[i], rawFiles[i], convId);
          }
        } catch {
          // If conversation creation fails, mark all new files as failed
          if (mountedRef.current) {
            const translatedError = translateConversation('upload.errors.createConversation');
            setFiles((prev) => prev.map((f) => (localIds.includes(f.localId) && f.status === 'uploading' ? { ...f, status: 'failed' as const, error: translatedError } : f)));
          }
        }
      })();
    },
    [ensureConversationId, uploadFile],
  );

  const removeFile = useCallback(
    (localId: string) => {
      setFiles((prev) => {
        const file = prev.find((f) => f.localId === localId);
        if (!file) return prev;

        // If uploading, abort the XHR
        const xhr = xhrMapRef.current.get(localId);
        if (xhr) {
          xhr.abort();
          xhrMapRef.current.delete(localId);
        }

        // If completed, fire-and-forget delete from backend
        const convId = externalConvId || resolvedConvId;
        if (file.status === 'completed' && file.documentId && convId) {
          deleteConversationFile(convId, file.documentId).catch(() => {
            // Silently ignore delete failures for removed files
          });
        }

        return prev.filter((f) => f.localId !== localId);
      });
    },
    [externalConvId, resolvedConvId],
  );

  const clearAll = useCallback(() => {
    // Abort all in-progress
    for (const xhr of xhrMapRef.current.values()) {
      xhr.abort();
    }
    xhrMapRef.current.clear();
    setFiles([]);
  }, []);

  const completedFileIds = files.filter((f) => f.status === 'completed' && f.documentId).map((f) => f.documentId!);

  const isUploading = files.some((f) => f.status === 'uploading' || f.status === 'confirming');

  return {
    files,
    addFiles,
    removeFile,
    completedFileIds,
    isUploading,
    clearAll,
    conversationId: effectiveConvId,
  };
}
