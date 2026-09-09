/**
 * useDebouncedSearch
 * Hook for debounced search input with proper cleanup.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Provides debounced search functionality.
 * Returns the current value, an onChange handler, and a reset function.
 *
 * @param onSearch - Callback invoked after the debounce delay
 * @param delay - Debounce delay in milliseconds (default: 300)
 */
export function useDebouncedSearch(onSearch: (value: string) => void, delay: number = 300) {
  const [value, setValue] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last value actually delivered to onSearch. An already-fired non-empty
  // search must be re-emitted as '' on reset/unmount, otherwise a store-level
  // filter (e.g. workspace searchQuery) outlives the input that set it.
  const lastSearchRef = useRef('');
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (lastSearchRef.current !== '') {
        lastSearchRef.current = '';
        onSearchRef.current('');
      }
    };
  }, []);

  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue);

      // Clear previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Debounce search
      timeoutRef.current = setTimeout(() => {
        lastSearchRef.current = newValue;
        onSearch(newValue);
      }, delay);
    },
    [onSearch, delay],
  );

  const reset = useCallback(() => {
    setValue('');
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (lastSearchRef.current !== '') {
      lastSearchRef.current = '';
      onSearch('');
    }
  }, [onSearch]);

  return { value, onChange: handleChange, reset };
}
