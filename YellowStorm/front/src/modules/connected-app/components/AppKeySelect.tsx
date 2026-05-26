import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppKeySelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  presets: Array<{ key: string; displayName: string; appKey: string }>;
  existingAppKeys?: string[];
}

export function AppKeySelect({
  id,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select or enter app key...',
  presets,
  existingAppKeys = [],
}: AppKeySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(!value || !presets.some((p) => p.appKey === value));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleSelect = (appKey: string) => {
    onChange(appKey);
    setShowCustomInput(false);
    setIsOpen(false);
  };

  const handleCustomInputChange = (newValue: string) => {
    onChange(newValue);
  };

  const handleClearCustomInput = () => {
    onChange('');
    setShowCustomInput(false);
  };

  const showCustomOption = true;

  const isAppExisting = (appKey: string) => existingAppKeys.includes(appKey);

  return (
    <div ref={containerRef} className="relative">
      {!showCustomInput ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background',
            'focus:outline-none focus:ring-1 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'ring-1 ring-ring',
          )}
        >
          <span className={value ? '' : 'text-muted-foreground'}>
            {value ? presets.find((p) => p.appKey === value)?.displayName || value : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      ) : (
        <div className="relative">
          <input
            id={id}
            type="text"
            value={value}
            onChange={(e) => handleCustomInputChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              'flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
          {value && (
            <button
              type="button"
              onClick={handleClearCustomInput}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            disabled={disabled}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </div>
      )}

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
            <div className="max-h-[--radix-select-content-available-height] overflow-y-auto p-1">
              {presets.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Preset Apps ({presets.length})
                  </div>
                  {presets.map((preset) => {
                    const existing = isAppExisting(preset.appKey);
                    return (
                      <button
                        type="button"
                        key={preset.key}
                        onClick={() => handleSelect(preset.appKey)}
                        className={cn(
                          'relative flex w-full cursor-pointer select-none items-center justify-between rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none',
                          'hover:bg-accent hover:text-accent-foreground',
                          value === preset.appKey && 'bg-accent text-accent-foreground',
                          existing && 'text-muted-foreground opacity-75',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span>{preset.displayName}</span>
                          <span className="text-xs text-muted-foreground">
                            ({preset.appKey})
                          </span>
                          {existing && (
                            <span className="px-1.5 py-0.5 text-xs bg-muted rounded">
                              Configured
                            </span>
                          )}
                        </div>
                        {value === preset.appKey && (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}

              {showCustomOption && (
                <>
                  {presets.length > 0 && (
                    <div className="my-1 h-px bg-muted" />
                  )}
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Custom
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomInput(true);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none',
                      'hover:bg-accent hover:text-accent-foreground',
                      showCustomInput && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span>Custom App Key...</span>
                  </button>
                </>
              )}
            </div>
          </div>
      )}
    </div>
  );
}