import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

/** Shape consumed by evaluator.py's benchmark_queries.json. */
export interface BenchmarkQuery {
  query_id: string;
  query: string;
  answer: string;
  required_file: string[];
  page: number[];
}

export interface ParsedBenchmark {
  sheetName: string;
  queries: BenchmarkQuery[];
  totalRows: number;
  skippedRows: number;
}

/** '10-23' | '25' → list of page numbers (port of xlsx_to_benchmark.py). */
function expandPagePart(part: string): number[] {
  const trimmed = part.trim();
  if (trimmed.includes('-')) {
    const [start, end] = trimmed.split('-').map((p) => parseInt(p, 10));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }
  const page = parseInt(trimmed, 10);
  return Number.isFinite(page) ? [page] : [];
}

/**
 * 'File.pdf, pages 10-23; File2.pdf, pages 8-19, 25-26'
 * → flat parallel arrays (files[], pages[]) pairing each page with its file.
 */
export function parseSources(raw: string): { files: string[]; pages: number[] } {
  const files: string[] = [];
  const pages: number[] = [];
  for (const entry of String(raw ?? '').split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const match = /^(.*?),\s*pages?\s+(.*)$/.exec(trimmed);
    if (!match) continue;
    const fileName = match[1].trim().replace(/,+$/, '').trim();
    for (const part of match[2].split(',')) {
      for (const page of expandPagePart(part)) {
        files.push(fileName);
        pages.push(page);
      }
    }
  }
  return { files, pages };
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function cellId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse the benchmark XLSX (sheet containing "Questions"; columns A=ID,
 * C=question, D=answer, F=sources) into the evaluator benchmark shape.
 */
export function parseBenchmarkWorkbook(buffer: Buffer): ParsedBenchmark {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new BadRequestException('Invalid Excel/CSV file: cannot be parsed.');
  }
  const sheetName = workbook.SheetNames.find((name) => name.includes('Questions'));
  if (!sheetName) {
    throw new BadRequestException('No sheet named "*Questions*" found in the workbook.');
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });

  const queries: BenchmarkQuery[] = [];
  let totalRows = 0;
  let skippedRows = 0;
  // Row 0 is the header; data starts at row 2 (index 1), like min_row=2.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const id = cellId(row[0]);
    const question = cellText(row[2]);
    if (id === null || !question) {
      if (row.some((cell) => cell !== null && cell !== undefined && cell !== '')) {
        totalRows++;
        skippedRows++;
      }
      continue;
    }
    totalRows++;
    const { files, pages } = parseSources(cellText(row[5]));
    queries.push({
      query_id: `Q${String(id).padStart(3, '0')}`,
      query: question,
      answer: cellText(row[3]),
      required_file: files,
      page: pages,
    });
  }

  if (queries.length === 0) {
    throw new BadRequestException('No valid questions found (columns A and C are required).');
  }
  return { sheetName, queries, totalRows, skippedRows };
}
