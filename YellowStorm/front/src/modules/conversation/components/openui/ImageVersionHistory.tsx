import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import { getGeneratedImageHistory, type ConversationImageVersion } from '../../api';
import { ImageActionToolbar, type ImageActionToolbarProps } from './ImageActionToolbar';

type ImageVersionHistoryProps = ImageActionToolbarProps & { open: boolean; onClose: () => void };

export function ImageVersionHistory(props: ImageVersionHistoryProps) {
  if (!props.open) return null;
  return <ImageVersionHistoryContent key={`${props.scope.conversationId}:${props.scope.messageId}:${props.source}`} {...props} />;
}

function ImageVersionHistoryContent({ open, onClose, ...actions }: ImageVersionHistoryProps) {
  const { t } = useModuleTranslation('conversation');
  const [versions, setVersions] = useState<ConversationImageVersion[]>([]);
  const [selection, setSelection] = useState<string>();
  const [preview, setPreview] = useState<{ version: ConversationImageVersion; blob: Blob; url: string }>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const anchor = /^generated-image:([a-f\d]{24})$/.exec(actions.source)?.[1];

  useEffect(() => {
    if (!open || !anchor) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview(undefined); setError(false); setLoading(true);
    void getGeneratedImageHistory(actions.scope.conversationId, actions.scope.messageId, anchor, selection, controller.signal)
      .then(async (result) => {
        const response = await fetch(result.selected.url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('Image unavailable');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size === 0 || blob.size > 20 * 1024 * 1024) throw new Error('Invalid image');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setVersions(result.versions);
        setPreview({ version: result.selected, blob, url: objectUrl });
      }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, anchor, selection, actions.scope.conversationId, actions.scope.messageId]);

  async function resolveAspectRatio() {
    if (!preview) throw new Error('Image unavailable');
    const image = await createImageBitmap(preview.blob);
    try {
      if (!image.width || !image.height) throw new Error('Invalid dimensions');
      return image.width > image.height ? 'landscape' as const : image.width < image.height ? 'portrait' as const : 'square' as const;
    } finally { image.close(); }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent closeLabel={t('openui.image.actions.close')} className='max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-auto'>
      <DialogTitle>{t('openui.image.history.title')}</DialogTitle>
      <DialogDescription>{t('openui.image.history.description')}</DialogDescription>
      <div className='grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]'>
        <div className='flex max-h-64 flex-col gap-1 overflow-auto' aria-label={t('openui.image.history.versions')}>
          {versions.map((version, index) => <Button key={version.source} type='button' variant={preview?.version.source === version.source ? 'secondary' : 'ghost'}
            className='h-auto justify-start whitespace-normal text-left' aria-pressed={preview?.version.source === version.source}
            onClick={() => setSelection(version.source)}>
            <span>{t('openui.image.history.version', { index: index + 1 })}<span className='block text-xs text-muted-foreground'>{new Date(version.createdAt).toLocaleString()}</span></span>
          </Button>)}
        </div>
        <div className='min-w-0'>
          {loading && <p role='status'>{t('openui.image.actions.loading')}</p>}
          {error && <p role='alert' className='text-sm text-destructive'>{t('openui.image.history.error')}</p>}
          {!loading && !error && preview && <>
            <figure><img src={preview.url} alt={preview.version.fileName} className='max-h-[50dvh] w-full object-contain' />
              <figcaption className='mt-2 break-words text-sm text-muted-foreground'>{preview.version.fileName}{preview.version.generated && <> · {t('openui.image.history.generated')}</>}</figcaption>
            </figure>
            <ImageActionToolbar {...actions} key={preview.version.source} source={preview.version.source} requestSource={preview.version.source}
              sourcePage={undefined} sourceNotice={undefined} url={preview.url} alt={preview.version.fileName} onHistory={undefined} peers={[]}
              resolveImage={async () => preview.blob} resolveAspectRatio={resolveAspectRatio} onSend={async (content) => { await actions.onSend(content); onClose(); }} />
          </>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
