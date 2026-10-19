export interface TableView {
  query: string;
  sortColumn: number | null;
  direction: 'asc' | 'desc';
  selectedRows: number[];
}

export function tableView(value: unknown): TableView {
  const view = value && typeof value === 'object' ? value as Partial<TableView> : {};
  return { query: typeof view.query === 'string' ? view.query.slice(0, 200) : '',
    sortColumn: Number.isInteger(view.sortColumn) && Number(view.sortColumn) >= 0 ? Number(view.sortColumn) : null,
    direction: view.direction === 'desc' ? 'desc' : 'asc',
    selectedRows: Array.isArray(view.selectedRows) ? view.selectedRows.filter(index => Number.isInteger(index) && index >= 0) : [] };
}

/** Keep original row identities and primitive types through filtering and sorting. */
export function getTableRows(rows: unknown[][], value: unknown): { row: unknown[]; index: number }[] {
  const view = tableView(value);
  const query = view.query.toLocaleLowerCase();
  const result = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.some(cell =>
    (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') && String(cell).toLocaleLowerCase().includes(query)));
  if (view.sortColumn !== null) result.sort((a, b) => {
    const left = a.row[view.sortColumn!]; const right = b.row[view.sortColumn!];
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''));
    return (view.direction === 'desc' ? -order : order) || a.index - b.index;
  });
  return result;
}

export interface ChartView { seriesIndex: number; labelIndex: number | null }
export function getChartData(labels: unknown[], series: { category?: string; values?: unknown[] }[], value: unknown) {
  const raw = value && typeof value === 'object' ? value as Partial<ChartView> : {};
  const view: ChartView = {
    seriesIndex: Number.isInteger(raw.seriesIndex) && Number(raw.seriesIndex) >= 0 && Number(raw.seriesIndex) < series.length ? Number(raw.seriesIndex) : -1,
    labelIndex: Number.isInteger(raw.labelIndex) && Number(raw.labelIndex) >= 0 && Number(raw.labelIndex) < labels.length ? Number(raw.labelIndex) : null,
  };
  const chosen = view.seriesIndex < 0 ? series : [series[view.seriesIndex]];
  return { view, labels: view.labelIndex === null ? labels : [labels[view.labelIndex]],
    series: chosen.map(entry => ({ ...entry, values: view.labelIndex === null ? entry.values : [entry.values?.[view.labelIndex]] })) };
}
