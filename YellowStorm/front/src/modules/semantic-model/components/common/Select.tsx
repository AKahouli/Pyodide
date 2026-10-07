import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { Select as BaseSelect, SelectContent as BaseSelectContent, SelectItem as BaseSelectItem } from '@/components/ui/select';

export { SelectGroup, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Lists longer than this get a search box. */
export const SEARCH_THRESHOLD = 8;

interface ListSearch {
  query: string;
  register: () => () => void;
  report: (shown: boolean) => () => void;
}

const SearchContext = React.createContext<ListSearch | null>(null);

/** Plain text of a rendered label, so items can be matched against the search. */
export function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The shared Select root; the list's search starts empty each time it opens, since the list remounts. */
export const Select = BaseSelect;

/**
 * The shared dropdown list, capped to the space left in the window (never taller than 20rem) and scrolling inside.
 * Once it holds more than SEARCH_THRESHOLD items it gets a search box that hides the items that do not match.
 */
export const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(({ className, children, onKeyDown, ...props }, ref) => {
  const { t } = useModuleTranslation('semantic-model');
  const [query, setQuery] = React.useState('');
  const [count, setCount] = React.useState(0);
  const [shown, setShown] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const register = React.useCallback(() => { setCount((value) => value + 1); return () => setCount((value) => value - 1); }, []);
  const report = React.useCallback((visible: boolean) => {
    if (!visible) return () => undefined;
    setShown((value) => value + 1);
    return () => setShown((value) => value - 1);
  }, []);
  const search = React.useMemo<ListSearch>(() => ({ query, register, report }), [query, register, report]);
  const searchable = count > SEARCH_THRESHOLD;

  React.useEffect(() => {
    if (!searchable) return;
    // Radix focuses the chosen item once the list is placed; the search box takes the focus after it.
    const timer = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [searchable]);

  const focusFirstItem = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const list = event.currentTarget.closest('[role="listbox"]');
    const first = list?.querySelector<HTMLElement>('[role="option"]:not([data-disabled])');
    first?.focus();
  };

  return (
    <BaseSelectContent
      ref={ref}
      className={cn('max-h-[min(20rem,var(--radix-select-content-available-height))]', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        // Letters typed while an item has the focus go to the search box rather than Radix's type-to-select.
        if (searchable && event.target !== input.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
          event.preventDefault();
          setQuery((current) => current + event.key);
          input.current?.focus();
        }
      }}
      {...props}>
      <SearchContext.Provider value={search}>
        {searchable && (
          <div className='sticky top-0 z-10 -mx-1 -mt-1 mb-1 flex items-center gap-2 border-b bg-popover px-2'>
            <Search className='h-4 w-4 shrink-0 opacity-50' aria-hidden />
            <input
              ref={input}
              className='h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
              value={query}
              placeholder={t('action.searchList')}
              aria-label={t('action.searchList')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); focusFirstItem(event); }
                // Keep Radix's type-to-select from taking the letters typed in the search box.
                if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
              }}
            />
          </div>
        )}
        {children}
        {searchable && query && shown === 0 && <p className='px-2 py-1.5 text-sm text-muted-foreground'>{t('action.noListMatch')}</p>}
      </SearchContext.Provider>
    </BaseSelectContent>
  );
});
SelectContent.displayName = 'SemanticSelectContent';

/** An item that hides itself (staying mounted, so the chosen value still shows) when it does not match the search. */
export const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(({ className, children, textValue, disabled, ...props }, ref) => {
  const search = React.useContext(SearchContext);
  const register = search?.register;
  const report = search?.report;
  const query = search ? fold(search.query.trim()) : '';
  const matches = !query || fold(textValue ?? nodeText(children)).includes(query);
  React.useEffect(() => register?.(), [register]);
  React.useEffect(() => report?.(matches), [report, matches]);
  return (
    <BaseSelectItem ref={ref} className={cn(!matches && 'hidden', className)} textValue={textValue} disabled={disabled || !matches} {...props}>
      {children}
    </BaseSelectItem>
  );
});
SelectItem.displayName = 'SemanticSelectItem';
