import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Loader2, Maximize2, Minimize2, RefreshCw, Search, X } from 'lucide-react';
import { Virtualizer, type VirtualizerHandle } from 'virtua';
import type { RendererProps } from '../../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { useFileViewerPendingNavigation } from '../../store';
import type { SheetData } from '../../utils/excel';
import { buildSheetData, getColumnLabel } from '../../utils/excel';

type ExcelModule = typeof import('exceljs');

export function SpreadsheetRenderer({ tab, isActive, onReady }: Readonly<RendererProps>) {
  const { t } = useModuleTranslation('file-viewer');
  const pendingNavigation = useFileViewerPendingNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string | null>(null);
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null);
  const [pendingFocusRow, setPendingFocusRow] = useState<number | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const navigationKeyRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const virtualizerRef = useRef<VirtualizerHandle | null>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const handleFullscreenChange = useCallback(() => {
    if (typeof document === 'undefined') return;
    setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleFullscreenChange]);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    setIsLoading(true);
    setError(null);
    setSheets([]);
    setHighlightedRow(null);
    setPendingFocusRow(null);

    async function loadWorkbook() {
      try {
        const response = await fetch(tab.url, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(t('excel.error.http', { status: response.status }));
        }

        const buffer = await response.arrayBuffer();
        const excelModule: ExcelModule = await import('exceljs');
        if (cancelled) return;

        const workbook = new excelModule.Workbook();
        await workbook.xlsx.load(buffer);
        if (cancelled) return;

        const sheetData = workbook.worksheets.map((worksheet) => buildSheetData(worksheet));
        const sheetNames = new Set(sheetData.map((sheet) => sheet.name));
        setSheets(sheetData);
        if (sheetData.length > 0) {
          setSelectedSheetName((prev) => {
            if (prev && sheetNames.has(prev)) {
              return prev;
            }
            return sheetData[0].name;
          });
        } else {
          setSelectedSheetName(null);
        }
        onReady?.();
      } catch (err) {
        if (abortController.signal.aborted || cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadWorkbook().catch(() => {
      if (!cancelled) {
        setError(t('excel.error.description'));
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [tab.url, loadVersion, onReady, t]);

  const selectedSheet = useMemo(() => sheets.find((sheet) => sheet.name === selectedSheetName) ?? null, [sheets, selectedSheetName]);
  const columnTemplate = useMemo(() => {
    const count = selectedSheet?.columnCount ?? 0;
    return `minmax(100px,auto) repeat(${count}, minmax(120px,auto))`;
  }, [selectedSheet?.columnCount]);

  const scrollToRow = useCallback((rowNumber: number) => {
    if (!virtualizerRef.current) {
      return false;
    }
    virtualizerRef.current.scrollToIndex(Math.max(0, rowNumber - 1));
    return true;
  }, []);

  useEffect(() => {
    if (!isActive || !selectedSheet || pendingFocusRow === null) {
      return;
    }
    const success = scrollToRow(pendingFocusRow);
    if (!success) {
      toast.warning(t('excel.navigation.rowMissing', { row: pendingFocusRow }));
    }
  }, [isActive, pendingFocusRow, selectedSheet, scrollToRow, t]);

  const performSearch = useCallback(
    (query: string, scrollToFirstMatch: boolean) => {
      if (!selectedSheet) {
        setMatches([]);
        setMatchIndex(0);
        return;
      }
      const normalized = query.trim().toLowerCase();
      if (!normalized) {
        setMatches([]);
        setMatchIndex(0);
        return;
      }
      const nextMatches = selectedSheet.rows.filter((row) => row.cells.some((cell) => (cell ?? '').toString().toLowerCase().includes(normalized))).map((row) => row.rowNumber);
      setMatches(nextMatches);
      setMatchIndex(0);
      if (nextMatches.length && scrollToFirstMatch) {
        const targetRow = nextMatches[0];
        setHighlightedRow(targetRow);
        setPendingFocusRow(targetRow);
      }
    },
    [selectedSheet],
  );

  useEffect(() => {
    if (searchOpen && searchQuery) {
      performSearch(searchQuery, false);
    }
    if (!searchOpen) {
      setMatches([]);
      setMatchIndex(0);
    }
  }, [performSearch, searchOpen, searchQuery]);

  const focusMatchByIndex = useCallback(
    (index: number) => {
      const rowNumber = matches[index];
      if (rowNumber === undefined) return;
      setMatchIndex(index);
      setHighlightedRow(rowNumber);
      setPendingFocusRow(rowNumber);
    },
    [matches],
  );

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    performSearch(searchQuery, true);
  };

  const handleSearchNext = () => {
    if (!matches.length) return;
    const nextIndex = (matchIndex + 1) % matches.length;
    focusMatchByIndex(nextIndex);
  };

  const handleSearchPrev = () => {
    if (!matches.length) return;
    const nextIndex = (matchIndex - 1 + matches.length) % matches.length;
    focusMatchByIndex(nextIndex);
  };

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setMatches([]);
    setMatchIndex(0);
  };

  const handleFullscreenToggle = async () => {
    if (typeof document === 'undefined' || !fullscreenRef.current) return;
    try {
      if (document.fullscreenElement === fullscreenRef.current) {
        await document.exitFullscreen();
      } else {
        await fullscreenRef.current.requestFullscreen();
      }
    } catch {
      toast.error(t('excel.fullscreen.error'));
    }
  };

  useEffect(() => {
    if (!isActive || !pendingNavigation || pendingNavigation?.tabId !== tab.id) {
      return;
    }
    if (!pendingNavigation.spreadsheet || sheets.length === 0) {
      return;
    }
    const { sheetName, sheetIndex, focusRow, highlightRow } = pendingNavigation.spreadsheet;
    let targetSheet: SheetData | undefined;
    if (sheetName) {
      const normalized = sheetName.trim().toLowerCase();
      targetSheet = sheets.find((sheet) => sheet.name.trim().toLowerCase() === normalized);
    }
    if (!targetSheet && typeof sheetIndex === 'number' && sheetIndex >= 1 && sheetIndex <= sheets.length) {
      targetSheet = sheets[sheetIndex - 1];
    }
    const resolvedHighlight = highlightRow ?? focusRow ?? null;
    const resolvedFocus = focusRow ?? highlightRow ?? null;
    const key = `${targetSheet?.name ?? 'missing'}:${resolvedFocus ?? ''}:${resolvedHighlight ?? ''}`;
    if (navigationKeyRef.current === key) {
      return;
    }
    navigationKeyRef.current = key;

    if (!targetSheet) {
      toast.warning(
        t('excel.navigation.sheetMissing', {
          sheet: sheetName ?? (typeof sheetIndex === 'number' ? sheetIndex : ''),
        }),
      );
      return;
    }

    setSelectedSheetName(targetSheet.name);
    setHighlightedRow(resolvedHighlight);
    setPendingFocusRow(resolvedFocus);
  }, [isActive, pendingNavigation, sheets, tab.id, t]);

  const handleDownload = useCallback(() => {
    const anchor = document.createElement('a');
    anchor.href = tab.url;
    anchor.download = tab.fileName || 'spreadsheet.xlsx';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [tab.fileName, tab.url]);

  const handleRetry = () => {
    setLoadVersion((prev) => prev + 1);
  };

  const handleSheetTabClick = useCallback((name: string) => {
    setSelectedSheetName(name);
    setHighlightedRow(null);
    setPendingFocusRow(null);
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const sheetDisplayName = selectedSheetName ?? t('excel.toolbar.sheetPlaceholder');
  const hasSheetTabs = sheets.length > 1;
  let searchSummary: string;
  if (matches.length) {
    searchSummary = t('excel.search.results', { current: matchIndex + 1, total: matches.length });
  } else if (searchQuery) {
    searchSummary = t('excel.search.noResults');
  } else {
    searchSummary = t('excel.search.placeholderHint');
  }
  const isSearchDisabled = !searchQuery.trim();

const renderRow = useCallback(
  (row: SheetData['rows'][number]) => {
    const isHighlighted = highlightedRow !== null && row.rowNumber === highlightedRow;
    const isEvenRow = row.rowNumber % 2 === 0;
    let rowBackgroundClass = 'bg-background';
    if (isHighlighted) {
      rowBackgroundClass = 'bg-primary/10 text-foreground dark:bg-primary/20';
    } else if (isEvenRow) {
      rowBackgroundClass = 'bg-muted/30';
    }

    let stickyCellBackground = 'bg-background text-muted-foreground';
    if (isHighlighted) {
      stickyCellBackground = 'bg-primary/20 text-foreground dark:bg-primary/30';
    } else if (isEvenRow) {
      stickyCellBackground = 'bg-muted/40 text-muted-foreground';
    }

      return (
        <div key={row.rowNumber} className={cn('grid min-w-max border-b border-border text-sm last:border-b-0', rowBackgroundClass)} style={{ gridTemplateColumns: columnTemplate }}>
          <div className={cn('sticky left-0 z-10 border-r border-border px-3 py-2 text-xs font-semibold backdrop-blur', stickyCellBackground)}>{row.rowNumber}</div>
          {Array.from({ length: selectedSheet?.columnCount ?? 0 }).map((_, colIndex) => (
            <div key={`${row.rowNumber}-${colIndex}`} className='px-3 py-2 text-sm text-foreground'>
              {row.cells[colIndex] ?? ''}
            </div>
          ))}
        </div>
      );
    },
    [columnTemplate, highlightedRow, selectedSheet?.columnCount],
  );

  let sheetContent;
  if (!selectedSheet) {
    sheetContent = <div className='flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground'>{t('excel.noSheet')}</div>;
  } else if (selectedSheet.rows.length === 0) {
    sheetContent = <div className='flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground'>{t('excel.empty')}</div>;
  } else {
    sheetContent = (
      <div ref={tableScrollRef} className='h-full w-full overflow-auto'>
        <div className='min-w-max'>
          <div className='sticky top-0 z-20 grid border-b border-border bg-muted/70 text-xs font-semibold text-muted-foreground backdrop-blur' style={{ gridTemplateColumns: columnTemplate }}>
            <div className='sticky left-0 z-30 border-r border-border px-3 py-2 text-left'>#</div>
            {Array.from({ length: selectedSheet.columnCount }).map((_, index) => {
              const columnLabel = getColumnLabel(index + 1);
              return (
                <div key={`header-${columnLabel}`} className='border-l border-border px-3 py-2 text-left'>
                  {columnLabel}
                </div>
              );
            })}
          </div>
          <div className='relative min-w-max'>
            <Virtualizer ref={virtualizerRef} data={selectedSheet.rows} scrollRef={tableScrollRef}>
              {(row) => renderRow(row)}
            </Virtualizer>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-border bg-muted/30 p-6 text-center text-sm'>
        <div>
          <p className='font-semibold text-destructive'>{t('excel.error.title')}</p>
          <p className='text-muted-foreground'>{t('excel.error.description')}</p>
          <p className='text-muted-foreground'>{error}</p>
        </div>
        <Button variant='outline' onClick={handleRetry}>
          <RefreshCw className='mr-2 h-4 w-4' />
          {t('actions.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div ref={fullscreenRef} className='flex h-full flex-col gap-3 p-3'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm'>
        <div className='flex flex-col gap-1'>
          <p className='text-xs font-medium uppercase text-muted-foreground'>{t('excel.toolbar.sheetLabel')}</p>
          <p className='text-base font-semibold text-foreground'>{sheetDisplayName}</p>
          {selectedSheet ? (
            <p className='text-xs text-muted-foreground'>
              {t('excel.sheetSummary', {
                rows: selectedSheet.rows.length,
                columns: selectedSheet.columnCount,
              })}
            </p>
          ) : null}
        </div>
        <div className='flex flex-1 flex-wrap items-center justify-end gap-2'>
          {searchOpen ? (
            <form className='flex flex-wrap items-center gap-2' onSubmit={handleSearchSubmit}>
              <Input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('excel.search.placeholder')} className='h-8 w-48 text-sm' />
              <span className='text-xs text-muted-foreground'>{searchSummary}</span>
              <div className='flex items-center gap-1'>
                <Button type='button' variant='ghost' size='icon' className='h-8 w-8' onClick={handleSearchPrev} disabled={!matches.length}>
                  <ChevronUp className='h-4 w-4' />
                </Button>
                <Button type='button' variant='ghost' size='icon' className='h-8 w-8' onClick={handleSearchNext} disabled={!matches.length}>
                  <ChevronDown className='h-4 w-4' />
                </Button>
                <Button type='button' variant='ghost' size='icon' className='h-8 w-8' onClick={handleSearchClose}>
                  <X className='h-4 w-4' />
                </Button>
              </div>
              <Button type='submit' variant='outline' size='sm' disabled={isSearchDisabled}>
                {t('excel.search.submit')}
              </Button>
            </form>
          ) : (
            <Button variant='outline' size='sm' onClick={() => setSearchOpen(true)}>
              <Search className='mr-2 h-4 w-4' />
              {t('excel.toolbar.search')}
            </Button>
          )}
          <Button variant='outline' size='sm' onClick={handleFullscreenToggle} disabled={!selectedSheet}>
            {isFullscreen ? (
              <>
                <Minimize2 className='mr-2 h-4 w-4' />
                {t('excel.toolbar.exitFullscreen')}
              </>
            ) : (
              <>
                <Maximize2 className='mr-2 h-4 w-4' />
                {t('excel.toolbar.enterFullscreen')}
              </>
            )}
          </Button>
          <Button variant='outline' size='sm' onClick={handleRetry} disabled={isLoading}>
            <RefreshCw className='mr-2 h-4 w-4' />
            {t('excel.toolbar.reload')}
          </Button>
          <Button variant='default' size='sm' onClick={handleDownload}>
            <Download className='mr-2 h-4 w-4' />
            {t('excel.toolbar.download')}
          </Button>
        </div>
      </div>
      <div className='flex-1 min-h-0 rounded-lg border border-border bg-background/80'>
        <div className='relative flex h-full flex-col overflow-hidden'>
          <div className='relative flex-1 min-h-0'>
            {sheetContent}
            {isLoading && (
              <div className='absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/80 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                <span>{t('excel.loading')}</span>
              </div>
            )}
          </div>
          {hasSheetTabs && (
            <div className='flex items-center gap-1 overflow-x-auto border-t border-border bg-muted/40 px-2 py-1.5 text-xs'>
              {sheets.map((sheet) => {
                const isActive = sheet.name === selectedSheetName;
                return (
                  <button key={sheet.name} type='button' onClick={() => handleSheetTabClick(sheet.name)} className={cn('flex min-w-24 items-center justify-center rounded-md border px-3 py-1 transition-colors', isActive ? 'border-primary bg-primary/10 text-foreground dark:bg-primary/20' : 'border-transparent text-muted-foreground hover:bg-muted')}>
                    <span className='truncate'>{sheet.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
