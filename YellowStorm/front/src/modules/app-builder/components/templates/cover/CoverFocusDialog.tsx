import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  COVER_MAX_ZOOM,
  COVER_MIN_ZOOM,
  clampFocusToImage,
  computeCoverCropRect,
  type CoverFocus,
  type CoverImageItem,
} from './cover-focus';

interface CoverFocusDialogProps {
  open: boolean;
  item: CoverImageItem | null;
  titlePreview: string;
  onOpenChange: (open: boolean) => void;
  onApply: (id: string, focus: CoverFocus) => void;
}

interface ImageSize {
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originCx: number;
  originCy: number;
}

function CoverCardPreview({
  src,
  focus,
  imageSize,
  title,
}: {
  src: string;
  focus: CoverFocus;
  imageSize: ImageSize | null;
  title: string;
}) {
  const { t } = useModuleTranslation('app-builder');
  const crop =
    imageSize && imageSize.width > 0
      ? computeCoverCropRect(imageSize.width, imageSize.height, focus)
      : null;

  const backgroundSize =
    crop && imageSize
      ? `${(imageSize.width / crop.width) * 100}% auto`
      : 'cover';
  const backgroundPosition =
    crop && imageSize
      ? `${(-crop.x / crop.width) * 100}% ${(-crop.y / crop.height) * 100}%`
      : '50% 50%';

  return (
    <div className='overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm'>
      <div
        className='aspect-[16/10] w-full bg-muted/40 bg-no-repeat'
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize,
          backgroundPosition,
        }}
        role='img'
        aria-label={t('coverFocus.previewAria')}
      />
      <div className='px-3 py-2.5'>
        <p className='truncate text-sm font-semibold text-foreground'>
          {title.trim() || t('coverFocus.previewUntitled')}
        </p>
        <p className='text-xs text-muted-foreground'>{t('coverFocus.previewHint')}</p>
      </div>
    </div>
  );
}

export function CoverFocusDialog({
  open,
  item,
  titlePreview,
  onOpenChange,
  onApply,
}: CoverFocusDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const stageRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<CoverFocus>({ cx: 0.5, cy: 0.5, zoom: 1 });
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    setFocus(item.focus);
    setImageSize(null);
  }, [open, item]);

  useEffect(() => {
    if (!open) return;
    const node = stageRef.current;
    if (!node) return;
    const sync = () => {
      const rect = node.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, item?.id]);

  const updateFocus = useCallback(
    (next: CoverFocus) => {
      if (!imageSize) {
        setFocus(next);
        return;
      }
      setFocus(clampFocusToImage(imageSize.width, imageSize.height, next));
    },
    [imageSize],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originCx: focus.cx,
      originCy: focus.cy,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !imageSize || stageSize.width <= 0) return;

    const displayScale = Math.min(
      stageSize.width / imageSize.width,
      stageSize.height / imageSize.height,
    );
    const displayedWidth = imageSize.width * displayScale;
    const displayedHeight = imageSize.height * displayScale;
    if (displayedWidth <= 0 || displayedHeight <= 0) return;

    const dx = (event.clientX - drag.startX) / displayedWidth;
    const dy = (event.clientY - drag.startY) / displayedHeight;
    updateFocus({
      ...focus,
      cx: drag.originCx - dx,
      cy: drag.originCy - dy,
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  if (!item) return null;

  const crop =
    imageSize && stageSize.width > 0
      ? (() => {
          const displayScale = Math.min(
            stageSize.width / imageSize.width,
            stageSize.height / imageSize.height,
          );
          const displayedWidth = imageSize.width * displayScale;
          const displayedHeight = imageSize.height * displayScale;
          const offsetX = (stageSize.width - displayedWidth) / 2;
          const offsetY = (stageSize.height - displayedHeight) / 2;
          const rect = computeCoverCropRect(imageSize.width, imageSize.height, focus);
          return {
            left: offsetX + rect.x * displayScale,
            top: offsetY + rect.y * displayScale,
            width: rect.width * displayScale,
            height: rect.height * displayScale,
          };
        })()
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[92vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0'>
        <DialogHeader className='space-y-1 border-b px-5 py-4 text-left'>
          <DialogTitle>{t('coverFocus.title')}</DialogTitle>
          <DialogDescription>{t('coverFocus.description')}</DialogDescription>
        </DialogHeader>

        <div className='grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.8fr)]'>
          <div className='space-y-3'>
            <div
              ref={stageRef}
              className='relative aspect-[4/3] w-full touch-none overflow-hidden rounded-xl border border-border/60 bg-muted/40'
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role='presentation'
            >
              <img
                src={item.previewUrl}
                alt=''
                draggable={false}
                className='pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain select-none'
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImageSize({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                }}
              />

              {crop ? (
                <>
                  <div
                    aria-hidden
                    className='pointer-events-none absolute bg-black/55'
                    style={{ left: 0, top: 0, right: 0, height: Math.max(0, crop.top) }}
                  />
                  <div
                    aria-hidden
                    className='pointer-events-none absolute bg-black/55'
                    style={{
                      left: 0,
                      top: crop.top + crop.height,
                      right: 0,
                      bottom: 0,
                    }}
                  />
                  <div
                    aria-hidden
                    className='pointer-events-none absolute bg-black/55'
                    style={{
                      left: 0,
                      top: crop.top,
                      width: Math.max(0, crop.left),
                      height: crop.height,
                    }}
                  />
                  <div
                    aria-hidden
                    className='pointer-events-none absolute bg-black/55'
                    style={{
                      left: crop.left + crop.width,
                      top: crop.top,
                      right: 0,
                      height: crop.height,
                    }}
                  />
                  <div
                    className={cn(
                      'absolute cursor-grab rounded-md border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] active:cursor-grabbing',
                      'ring-2 ring-primary/40',
                    )}
                    style={{
                      left: crop.left,
                      top: crop.top,
                      width: crop.width,
                      height: crop.height,
                    }}
                  >
                    <span className='absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm'>
                      <Crosshair className='size-4' aria-hidden />
                    </span>
                    <span className='pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/25' />
                    <span className='pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/25' />
                    <span className='pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/25' />
                    <span className='pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/25' />
                  </div>
                </>
              ) : null}
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between gap-2'>
                <Label htmlFor='cover-focus-zoom' className='text-sm'>
                  {t('coverFocus.zoom')}
                </Label>
                <span className='tabular-nums text-xs text-muted-foreground'>
                  {focus.zoom.toFixed(1)}×
                </span>
              </div>
              <div className='flex items-center gap-3'>
                <ZoomOut className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                <Slider
                  id='cover-focus-zoom'
                  min={COVER_MIN_ZOOM}
                  max={COVER_MAX_ZOOM}
                  step={0.05}
                  value={[focus.zoom]}
                  aria-label={t('coverFocus.zoom')}
                  onValueChange={(values) => {
                    const zoom = values[0] ?? COVER_MIN_ZOOM;
                    updateFocus({ ...focus, zoom });
                  }}
                />
                <ZoomIn className='size-4 shrink-0 text-muted-foreground' aria-hidden />
              </div>
              <p className='text-xs text-muted-foreground'>{t('coverFocus.dragHint')}</p>
            </div>
          </div>

          <div className='space-y-3'>
            <p className='text-sm font-medium text-foreground'>{t('coverFocus.livePreview')}</p>
            <CoverCardPreview
              src={item.previewUrl}
              focus={focus}
              imageSize={imageSize}
              title={titlePreview}
            />
            <p className='text-xs leading-relaxed text-muted-foreground'>
              {t('coverFocus.aspectHint', { aspect: '16:10' })}
            </p>
          </div>
        </div>

        <DialogFooter className='gap-2 border-t px-5 py-4 sm:justify-between'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => updateFocus({ cx: 0.5, cy: 0.5, zoom: 1 })}
          >
            {t('coverFocus.reset')}
          </Button>
          <div className='flex gap-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('card.cancel')}
            </Button>
            <Button
              type='button'
              onClick={() => {
                onApply(item.id, focus);
                onOpenChange(false);
              }}
            >
              {t('coverFocus.apply')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
