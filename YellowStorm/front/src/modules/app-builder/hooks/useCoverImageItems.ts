import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import {
  COVER_MAX_IMAGES,
  defaultCoverFocus,
  screenshotCoverFocus,
  type CoverFocus,
  type CoverImageItem,
} from '../components/templates/cover/cover-focus';

function createCoverItem(
  file: File,
  isPrimary: boolean,
  focus = defaultCoverFocus(),
): CoverImageItem {
  return {
    id: nanoid(),
    file,
    previewUrl: URL.createObjectURL(file),
    focus,
    isPrimary,
  };
}

function revokeCoverUrls(items: CoverImageItem[]): void {
  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

/**
 * Cover gallery state for TemplateFormDrawer: blob URLs, primary, focus, revoke.
 */
export function useCoverImageItems() {
  const [coverItems, setCoverItems] = useState<CoverImageItem[]>([]);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const coverItemsRef = useRef(coverItems);
  coverItemsRef.current = coverItems;

  useEffect(() => {
    return () => {
      revokeCoverUrls(coverItemsRef.current);
    };
  }, []);

  const resetCoverItems = useCallback(() => {
    revokeCoverUrls(coverItemsRef.current);
    setCoverItems([]);
    setFocusItemId(null);
  }, []);

  const addCoverFiles = useCallback((files: File[]) => {
    setCoverItems((prev) => {
      const remaining = COVER_MAX_IMAGES - prev.length;
      if (remaining <= 0) return prev;
      const nextFiles = files.slice(0, remaining);
      const created = nextFiles.map((file, index) =>
        createCoverItem(file, prev.length === 0 && index === 0),
      );
      return [...prev, ...created];
    });
  }, []);

  const removeCover = useCallback((id: string) => {
    setCoverItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((item) => item.id !== id);
      if (next.length > 0 && !next.some((item) => item.isPrimary)) {
        next[0] = { ...next[0]!, isPrimary: true };
      }
      return next;
    });
    setFocusItemId((current) => (current === id ? null : current));
  }, []);

  const setPrimaryCover = useCallback((id: string) => {
    setCoverItems((prev) =>
      prev.map((item) => ({
        ...item,
        isPrimary: item.id === id,
      })),
    );
  }, []);

  const applyFocus = useCallback((id: string, focus: CoverFocus) => {
    setCoverItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, focus } : item)),
    );
  }, []);

  /** Replace gallery with a single Template Studio validation screenshot cover. */
  const replaceWithValidatedCover = useCallback((file: File) => {
    setCoverItems((prev) => {
      revokeCoverUrls(prev);
      return [createCoverItem(file, true, screenshotCoverFocus())];
    });
    setFocusItemId(null);
  }, []);

  const primaryCover = coverItems.find((item) => item.isPrimary) ?? coverItems[0] ?? null;
  const focusItem = coverItems.find((item) => item.id === focusItemId) ?? null;

  return {
    coverItems,
    primaryCover,
    focusItem,
    setFocusItemId,
    resetCoverItems,
    addCoverFiles,
    removeCover,
    setPrimaryCover,
    applyFocus,
    replaceWithValidatedCover,
  };
}
