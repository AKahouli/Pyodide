import { useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Undo2, Redo2, Trash2, Check } from 'lucide-react';
import { SketchBoardToolbar } from './SketchBoardToolbar';
import { useDrawingCanvas } from './useDrawingCanvas';
import { useModuleTranslation } from '@/modules/localization';

interface SketchBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (file: File) => void;
}

export function SketchBoardDialog({ open, onOpenChange, onDone }: SketchBoardDialogProps) {
  const drawing = useDrawingCanvas();
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  // Keep canvas resolution in sync when the dialog / window resizes.
  // The heavy lifting is done by ensureSize() in the hook (called on first
  // stroke), but this observer handles resize-after-open scenarios.
  useEffect(() => {
    if (!open) return;
    const canvas = drawing.canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => drawing.ensureSize());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [open, drawing.canvasRef, drawing.ensureSize]);

  const handleDone = useCallback(async () => {
    try {
      const blob = await drawing.exportToPng();
      const file = new File([blob], `sketch-${Date.now()}.png`, { type: 'image/png' });
      onDone(file);
      onOpenChange(false);
      drawing.reset();
    } catch {
      // Export failed — canvas might be empty
    }
  }, [drawing, onDone, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
    drawing.reset();
  }, [onOpenChange, drawing]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
        else onOpenChange(v);
      }}>
      <DialogContent className='max-w-5xl w-[calc(90vh*16/9)] max-h-[90vh] aspect-video overflow-hidden flex flex-col p-0 gap-0' onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogTitle className='sr-only'>{t('sketch.title')}</DialogTitle>

        {/* Toolbar */}
        <SketchBoardToolbar tool={drawing.tool} setTool={drawing.setTool} color={drawing.color} setColor={drawing.setColor} brushSize={drawing.brushSize} setBrushSize={drawing.setBrushSize} onBackgroundImage={drawing.setBackgroundImage} />

        {/* Canvas area — flex-1 gives the wrapper its size, w-full h-full
            makes the canvas fill it, and ensureSize() sets the pixel buffer */}
        <div className='flex-1 min-h-0 bg-white cursor-crosshair overflow-hidden'>
          <canvas ref={drawing.canvasRef} className='block w-full h-full touch-none' onPointerDown={drawing.startStroke} onPointerMove={drawing.continueStroke} onPointerUp={drawing.endStroke} onPointerLeave={drawing.endStroke} />
        </div>

        {/* Footer */}
        <div className='flex shrink-0 h-14 items-center justify-between border-t px-4'>
          <div className='flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='outline' size='icon' className='size-8' disabled={!drawing.canUndo} onClick={drawing.undo}>
                  <Undo2 className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sketch.tooltips.undo')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='outline' size='icon' className='size-8' disabled={!drawing.canRedo} onClick={drawing.redo}>
                  <Redo2 className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sketch.tooltips.redo')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='outline' size='icon' className='size-8' onClick={drawing.clear}>
                  <Trash2 className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sketch.tooltips.clear')}</TooltipContent>
            </Tooltip>
          </div>

          <div className='flex items-center gap-2'>
            <Button variant='outline' onClick={handleCancel}>
              {tCommon('actionCancel')}
            </Button>
            <Button onClick={handleDone} disabled={drawing.isEmpty}>
              <Check className='mr-1 size-4' />
              {t('sketch.buttons.done')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
