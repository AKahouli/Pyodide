import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Pencil, Eraser, Palette, ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

const PRESET_COLORS = ['#000000', '#ef4444', '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#eab308', '#ffffff'];

interface SketchBoardToolbarProps {
  tool: 'pen' | 'eraser';
  setTool: (tool: 'pen' | 'eraser') => void;
  color: string;
  setColor: (color: string) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  onBackgroundImage: (file: File) => void;
}

export function SketchBoardToolbar({ tool, setTool, color, setColor, brushSize, setBrushSize, onBackgroundImage }: SketchBoardToolbarProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const { t } = useModuleTranslation('conversation');

  return (
    <div className='flex shrink-0 h-12 items-center gap-2 border-b px-4'>
      {/* Tool toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant={tool === 'pen' ? 'default' : 'outline'} size='icon' className='size-8' onClick={() => setTool('pen')}>
            <Pencil className='size-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('sketch.toolbar.pen')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant={tool === 'eraser' ? 'default' : 'outline'} size='icon' className='size-8' onClick={() => setTool('eraser')}>
            <Eraser className='size-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('sketch.toolbar.eraser')}</TooltipContent>
      </Tooltip>

      <Separator orientation='vertical' className='mx-1 h-6' />

      {/* Color swatches */}
      <div className='flex items-center gap-1'>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={cn('size-6 rounded-full border-2 transition-transform hover:scale-110', color === c && tool === 'pen' ? 'border-primary scale-110' : 'border-muted-foreground/30')}
            style={{ backgroundColor: c }}
            onClick={() => {
              setColor(c);
              setTool('pen');
            }}
          />
        ))}

        {/* Custom color picker */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='outline' size='icon' className='size-8' onClick={() => colorInputRef.current?.click()}>
              <Palette className='size-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sketch.toolbar.customColor')}</TooltipContent>
        </Tooltip>
        <input
          ref={colorInputRef}
          type='color'
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            setTool('pen');
          }}
          className='sr-only'
        />
      </div>

      <Separator orientation='vertical' className='mx-1 h-6' />

      {/* Brush size */}
      <div className='flex items-center gap-2'>
        <Slider value={[brushSize]} onValueChange={([v]) => setBrushSize(v)} min={1} max={20} step={1} className='w-24' />
        <div className='rounded-full bg-foreground shrink-0' style={{ width: brushSize, height: brushSize }} />
      </div>

      <Separator orientation='vertical' className='mx-1 h-6' />

      {/* Background image */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='outline' size='icon' className='size-8' onClick={() => bgInputRef.current?.click()}>
            <ImagePlus className='size-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('sketch.toolbar.addBackground')}</TooltipContent>
      </Tooltip>
      <input
        ref={bgInputRef}
        type='file'
        accept='image/*'
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onBackgroundImage(file);
            e.target.value = '';
          }
        }}
        className='sr-only'
      />
    </div>
  );
}
