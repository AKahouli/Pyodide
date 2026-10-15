import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';

export interface ImageActionToolbarProps {
  source: string;
  requestSource?: string;
  sourcePage?: number;
  sourceNotice?: string;
  connectorName?: string;
  alt: string;
  scope: { conversationId: string; messageId: string };
  url?: string;
  streaming?: boolean;
  canEdit?: boolean;
  canReuse?: boolean;
  canReuseSlides?: boolean;
  peers?: { source: string; label: string }[];
  resolveImage: (source: string) => Promise<Blob>;
  resolveAspectRatio?: () => Promise<'square' | 'landscape' | 'portrait'>;
  onSend: (content: string) => Promise<void>;
  onHistory?: () => void;
}

type ActionLabel = 'toolbar' | 'edit' | 'compare' | 'reuse' | 'docx' | 'pptx' | 'slides' |
  'download' | 'error' | 'close' | 'editDescription' | 'instruction' | 'required' |
  'cancel' | 'submit' | 'compareDescription' | 'comparisonImage' | 'loading' | 'selectedImage' | 'reuseDescription' | 'working';

export function ImageActionToolbar({ source, requestSource, sourcePage, sourceNotice, connectorName, alt, scope, url, streaming = false, canEdit = false,
  canReuse = false, canReuseSlides = canReuse, peers = [], resolveImage, resolveAspectRatio, onSend, onHistory }: ImageActionToolbarProps) {
  const { t } = useModuleTranslation('conversation');
  const inputId = useId();
  const label = (key: ActionLabel) => t(`openui.image.actions.${key}`);
  const [editing, setEditing] = useState(false);
  const [reuseFormat, setReuseFormat] = useState<'docx' | 'pptx' | 'slides' | null>(null);
  const [comparing, setComparing] = useState(false);
  const [peer, setPeer] = useState('');
  const [comparison, setComparison] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const candidates = peers.filter((candidate) => candidate.source !== source);
  const form = useForm<{ prompt: string }>({
    resolver: zodResolver(z.object({ prompt: z.string().trim().min(1, label('required')) })),
    defaultValues: { prompt: '' },
  });
  const disabled = streaming || busy;

  useEffect(() => {
    if (!comparing || !peer) return;
    let active = true;
    const urls: string[] = [];
    setComparison([]);
    setError(false);
    void Promise.all([resolveImage(source), resolveImage(peer)]).then((blobs) => {
      if (!active) return;
      if (blobs.some((blob) => !blob.type.startsWith('image/'))) throw new Error('Unsupported image');
      urls.push(...blobs.map((blob) => URL.createObjectURL(blob)));
      setComparison(urls);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; urls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl)); };
  }, [comparing, peer, source, resolveImage]);

  async function send(content: string | (() => Promise<string>)) {
    if (disabled) return;
    setBusy(true);
    setError(false);
    try { await onSend(typeof content === 'function' ? await content() : content); setEditing(false); setReuseFormat(null); form.reset(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }

  const context = { source: JSON.stringify(requestSource ?? source), sourcePage: JSON.stringify(sourcePage ?? null), messageId: JSON.stringify(scope.messageId), connector: JSON.stringify(connectorName ?? null) };
  const selectedImage = <figure className='space-y-2'>
    {url?.startsWith('blob:') && <img src={url} alt={alt} className='max-h-52 w-full rounded-md object-contain' />}
    <figcaption className='break-words text-sm text-muted-foreground'>{label('selectedImage')}: {alt}</figcaption>
    {sourceNotice && <p className='text-sm text-muted-foreground'>{sourceNotice}</p>}
  </figure>;
  return <div className='mt-2 flex flex-wrap items-center gap-2' aria-label={label('toolbar')}>
    {onHistory && <Button type='button' variant='outline' size='sm' disabled={disabled} onClick={onHistory}>{t('openui.image.history.title')}</Button>}
    <Button type='button' variant='outline' size='sm' disabled={disabled || !canEdit}
      onClick={() => { setError(false); setEditing(true); }}>{label('edit')}</Button>
    <Button type='button' variant='outline' size='sm' disabled={disabled || !candidates.length}
      onClick={() => { setPeer(candidates[0]?.source ?? ''); setError(false); setComparing(true); }}>{label('compare')}</Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button type='button' variant='outline' size='sm'
      disabled={disabled || (!canReuse && !canReuseSlides)}>{label('reuse')}</Button></DropdownMenuTrigger>
      <DropdownMenuContent>{(['docx', 'pptx', 'slides'] as const).map((format) =>
        <DropdownMenuItem key={format} disabled={disabled || !(format === 'slides' ? canReuseSlides : canReuse)} onSelect={() => {
          setError(false); setReuseFormat(format);
        }}>{label(format)}</DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>
    {url?.startsWith('blob:') && (disabled ? <Button disabled variant='outline' size='sm'>{label('download')}</Button> : <Button asChild variant='outline' size='sm'>
      <a href={url} download='image' aria-label={label('download')}>{label('download')}</a>
    </Button>)}
    {error && !editing && !comparing && !reuseFormat && <p role='alert' className='text-sm text-destructive'>{label('error')}</p>}
    <Dialog open={editing} onOpenChange={(open) => { if (!busy) { setEditing(open); if (!open) form.reset(); } }}>
      <DialogContent closeLabel={label('close')} className='max-h-[90dvh] w-[calc(100%-2rem)] overflow-auto'>
        <DialogTitle>{label('edit')}</DialogTitle><DialogDescription>{label('editDescription')}</DialogDescription>
        {selectedImage}
        <form className='space-y-3' onSubmit={form.handleSubmit(({ prompt }) => {
          if (canEdit) void send(async () => {
            if (!resolveAspectRatio) throw new Error('Image dimensions unavailable');
            const aspectRatio = await resolveAspectRatio();
            return t('openui.image.actions.editRequest', { ...context, prompt: JSON.stringify(prompt), aspectRatio: JSON.stringify(aspectRatio) });
          });
        })}>
          <label htmlFor={inputId}>{label('instruction')}</label>
          <Textarea id={inputId} disabled={busy} {...form.register('prompt')} />
          {form.formState.errors.prompt && <p role='alert' className='text-sm text-destructive'>{form.formState.errors.prompt.message}</p>}
          {error && <p role='alert' className='text-sm text-destructive'>{label('error')}</p>}
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' disabled={busy} onClick={() => { setEditing(false); form.reset(); }}>{label('cancel')}</Button>
            <Button type='submit' disabled={disabled || !canEdit}>{label('submit')}</Button>
          </div>
          {busy && <p role='status' className='text-sm text-muted-foreground'>{label('working')}</p>}
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={reuseFormat !== null} onOpenChange={(open) => { if (!open && !busy) setReuseFormat(null); }}>
      <DialogContent closeLabel={label('close')} className='max-h-[90dvh] w-[calc(100%-2rem)] overflow-auto'>
        <DialogTitle>{reuseFormat ? label(reuseFormat) : label('reuse')}</DialogTitle>
        <DialogDescription>{label('reuseDescription')}</DialogDescription>
        {selectedImage}
        {error && <p role='alert' className='text-sm text-destructive'>{label('error')}</p>}
        {busy && <p role='status' className='text-sm text-muted-foreground'>{label('working')}</p>}
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='outline' disabled={busy} onClick={() => setReuseFormat(null)}>{label('cancel')}</Button>
          <Button type='button' disabled={disabled || !reuseFormat || !(reuseFormat === 'slides' ? canReuseSlides : canReuse)}
            onClick={() => { if (reuseFormat) void send(t(`openui.image.actions.reuseRequest.${reuseFormat}`, context)); }}>
            {reuseFormat ? label(reuseFormat) : label('reuse')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={comparing} onOpenChange={setComparing}>
      <DialogContent closeLabel={label('close')} className='max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-auto'>
        <DialogTitle>{label('compare')}</DialogTitle><DialogDescription>{label('compareDescription')}</DialogDescription>
        <label>{label('comparisonImage')}<select className='ml-2 rounded border bg-background p-2' value={peer} onChange={(event) => setPeer(event.target.value)}>
          {candidates.map((candidate) => <option key={candidate.source} value={candidate.source}>{candidate.label}</option>)}
        </select></label>
        {error ? <p role='alert'>{label('error')}</p> : comparison.length === 2 ?
          <div className='grid gap-4 sm:grid-cols-2'>{comparison.map((imageUrl, index) => <figure key={imageUrl}>
            <img className='max-h-[55dvh] w-full object-contain' src={imageUrl} alt={index === 0 ? alt : candidates.find((candidate) => candidate.source === peer)?.label || label('comparisonImage')} />
            <figcaption className='mt-2 text-sm text-muted-foreground'>{index === 0 ? alt : candidates.find((candidate) => candidate.source === peer)?.label}</figcaption>
          </figure>)}</div> : <p role='status'>{label('loading')}</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
