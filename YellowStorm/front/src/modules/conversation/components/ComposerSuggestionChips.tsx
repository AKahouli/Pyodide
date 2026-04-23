import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { useModuleTranslation } from '@/modules/localization';
import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useComposerSuggestions } from '../hooks/useComposerSuggestions';

export interface ComposerSuggestionChipsProps {
  /** When true, no network requests are made and chips are cleared. */
  fetchDisabled: boolean;
}

export function ComposerSuggestionChips({ fetchDisabled }: ComposerSuggestionChipsProps) {
  const { t } = useModuleTranslation('conversation');
  const { textInput } = usePromptInputController();
  const { suggestion, loading, fetchError } = useComposerSuggestions({
    draftText: textInput.value,
    enabled: !fetchDisabled,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Find the textarea in the DOM
  useEffect(() => {
    const textarea = document.querySelector('textarea[data-slot="input-group-control"]') as HTMLTextAreaElement;
    textareaRef.current = textarea;
  }, []);

  // Calculate position when suggestion appears
  useEffect(() => {
    const showBar = loading || fetchError || (suggestion !== null && suggestion.length > 0);

    if (!showBar || fetchDisabled) {
      setIsVisible(false);
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    const textareaRect = textarea.getBoundingClientRect();
    const inputGroup = textarea.closest('[data-slot="input-group"]');
    const inputGroupRect = inputGroup?.getBoundingClientRect();

    if (inputGroupRect) {
      setPosition({
        top: inputGroupRect.bottom + 4,
        left: inputGroupRect.left,
        width: inputGroupRect.width,
      });
      setIsVisible(true);
    }
  }, [loading, fetchError, suggestion, fetchDisabled]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isVisible || !position) return;

    const handleScroll = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const inputGroup = textarea.closest('[data-slot="input-group"]');
      const inputGroupRect = inputGroup?.getBoundingClientRect();

      if (inputGroupRect) {
        setPosition({
          top: inputGroupRect.bottom + 4,
          left: inputGroupRect.left,
          width: inputGroupRect.width,
        });
      }
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isVisible, position]);

  // Handle click outside to close
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        const textarea = textareaRef.current;
        if (textarea && !textarea.contains(e.target as Node)) {
          setIsVisible(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isVisible) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsVisible(false);
      }
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [isVisible]);

  const handleApply = useCallback(() => {
    if (suggestion) {
      textInput.setInput(suggestion);
      setIsVisible(false);
    }
  }, [suggestion, textInput]);

  if (!isVisible || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={containerRef}
      className='fixed z-[100] animate-in fade-in-0 slide-in-from-bottom-2 duration-200'
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxWidth: 'calc(100vw - 16px)',
      }}>
      <div className='rounded-lg border border-border/60 bg-popover shadow-lg shadow-black/10 dark:shadow-black/40 overflow-hidden'>
        <div className='flex flex-col'>
          {/* Header */}
          <div className='flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border/40'>
            <Sparkles className='h-4 w-4 text-primary' />
            <span className='text-xs font-medium text-muted-foreground'>{t('composerSuggestions.barLabel')}</span>
          </div>

          {/* Content */}
          <div className='p-1.5'>
            {loading && (
              <div className='flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                <span>{t('composerSuggestions.loading')}</span>
              </div>
            )}

            {fetchError && !loading && (
              <div className='px-4 py-6 text-sm text-destructive text-center'>
                {t('composerSuggestions.unavailable')}
              </div>
            )}

            {suggestion && suggestion.length > 0 && !loading && (
              <button
                type='button'
                onClick={handleApply}
                className={cn(
                  'w-full text-left',
                  'relative flex items-start gap-3',
                  'rounded-md px-4 py-3',
                  'text-sm leading-relaxed',
                  'text-foreground',
                  'whitespace-normal break-words',
                  'transition-all duration-150',
                  'hover:bg-accent/80 hover:shadow-sm',
                  'active:scale-[0.98]',
                  'outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                  'cursor-pointer select-none'
                )}>
                <span className='flex-1'>{suggestion}</span>
                <div className='mt-0.5 opacity-50 hover:opacity-100 transition-opacity'>
                  <svg className='h-4 w-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                    <path d='M5 12h14' />
                    <path d='m12 5 7 7-7 7' />
                  </svg>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
