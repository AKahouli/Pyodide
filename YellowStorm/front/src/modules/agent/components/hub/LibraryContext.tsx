import { createContext, useContext } from 'react';
import type { LibraryItem } from './library-model';

export const LibraryContext = createContext<{
  preview: (item: LibraryItem) => void;
  start: (item: LibraryItem, draft?: string) => void;
  toggleSaved: (item: LibraryItem) => void;
  saved: string[];
} | null>(null);
export const useLibrary = () => useContext(LibraryContext);
