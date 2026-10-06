// Faithful TS port of yellowstorm-adk/evaluation/evaluator.py metrics used by
// LogicalSearch evaluation runs. Mirrors the Python logic so benchmark numbers
// stay comparable between the Python (standalone) and TS (in-app) runners.

export interface ExpectedSource {
  file: string;
  page: number | null;
}

export interface FilePagePair {
  file: string;
  page: number;
}

export interface ToolCall {
  node_id: string;
  iteration: number;
  args?: unknown;
  output_summary?: unknown;
  result?: unknown;
  output?: unknown;
  content?: unknown;
  response?: unknown;
  [key: string]: unknown;
}

export interface RetrievalMetrics {
  expected_files: string[];
  expected_sources: ExpectedSource[];
  retrieved_files: string[];
  retrieved_count: number;
  retrieved_candidate_count: number;
  retrieved_pages: number[];
  retrieved_sources: FilePagePair[];
  required_files_found: string[];
  matched_sources: ExpectedSource[];
  file_recall: number;
  file_precision: number;
  page_hit_count: number;
  page_hit: boolean;
  retrieval_success: boolean;
  exact_match: boolean;
}

export interface AnswerMetrics {
  token_recall: number;
  token_precision: number;
  f1: number;
  semantic_similarity: number;
  fact_recall: number;
  fact_precision: number;
  expected_facts: string[];
  generated_facts: string[];
  matched_facts: string[];
  answer_correctness: number;
  answer_quality: number;
  exact_match: boolean;
  expected_answer_clean: string;
  generated_answer_clean: string;
}

export interface Metrics {
  retrieval: RetrievalMetrics;
  answer: AnswerMetrics;
}

const PDF_NAME_PATTERN = /([A-Za-z0-9][A-Za-z0-9_().&'-]*\.pdf)/gi;

const PAGE_KEYWORDS = new Set(['page', 'page_number', 'page_num', 'pageno', 'page_no']);

export interface EvaluationProgress {
  done: number;
  total: number;
  currentIndex: number;
  currentQueryId: string;
  currentQuery: string;
  startedAt: string;
  updatedAt: string;
}

// ----------------------------------------------------------------
// Text normalization / tokenization
// ----------------------------------------------------------------

export function normalizeText(text: string): string {
  let normalized = text.toLowerCase();
  normalized = normalized.replace(/\[\d+\]/g, ' ');
  normalized = normalized.replace(/#+/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  normalized = normalized.replace(/[^\w\s%€$£.,:/+\-()]/g, ' ');
  return normalized.trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.match(/\b[\wÀ-ÿ]+\b|[%€$£]|\d+(?:[.,]\d+)?/g) ?? [];
}

export function tokenOverlapMetrics(expected: string, generated: string): { recall: number; precision: number; f1: number } {
  const expectedTokens = tokenize(expected);
  const generatedTokens = tokenize(generated);

  if (expectedTokens.length === 0) {
    return { recall: 1.0, precision: generatedTokens.length === 0 ? 1.0 : 0.0, f1: generatedTokens.length === 0 ? 1.0 : 0.0 };
  }
  if (generatedTokens.length === 0) {
    return { recall: 0.0, precision: 0.0, f1: 0.0 };
  }

  const expectedSet = new Set(expectedTokens);
  const generatedSet = new Set(generatedTokens);
  const overlap = [...expectedSet].filter((token) => generatedSet.has(token));

  const recall = overlap.length / expectedSet.size;
  const precision = overlap.length / generatedSet.size;
  const f1 = recall + precision === 0 ? 0.0 : (2 * recall * precision) / (recall + precision);

  return { recall: round4(recall), precision: round4(precision), f1: round4(f1) };
}

// difflib.SequenceMatcher(None, a, b).ratio() ≈ 2 * LCS / (|a| + |b|)
// Rolling-row LCS keeps memory O(min(len)) while matching difflib's ratio.
export function semanticSimilarity(expected: string, generated: string): number {
  if (!expected || !generated) return 0.0;
  const a = normalizeText(expected);
  const b = normalizeText(generated);
  const lcs = lcsLength(a, b);
  return round4((2 * lcs) / (a.length + b.length));
}

function lcsLength(a: string, b: string): number {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  let prev: number[] = Array.from({ length: shorter.length + 1 }, () => 0);
  for (let i = 1; i <= longer.length; i++) {
    const curr: number[] = Array.from({ length: shorter.length + 1 }, () => 0);
    for (let j = 1; j <= shorter.length; j++) {
      curr[j] = longer[i - 1] === shorter[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[shorter.length];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ----------------------------------------------------------------
// Fact extraction
// ----------------------------------------------------------------

export function extractFacts(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/\[\d+\]/g, ' ');
  const facts: string[] = [];

  const percentageMatches = cleaned.match(/\b\d+(?:[.,]\d+)?\s*%/gi) ?? [];
  for (const match of percentageMatches) facts.push(normalizeText(match));

  const currencyMatches = cleaned.match(/\$€£\s*\d+(?:[.,]\d+)*|\b\d+(?:[.,]\d+)*\s*(?:EUR|USD|GBP)\b/gi) ?? [];
  for (const match of currencyMatches) facts.push(normalizeText(match));

  const durationPatterns = [
    /\b\d+(?:[.,]\d+)?\s*(?:MWh|kWh|MW|kW)\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|h|heures?)\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:days?|jours?)\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:years?|ans?)\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:months?|mois)\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:weeks?|semaines?)\b/gi,
  ];
  for (const pattern of durationPatterns) {
    const matches = cleaned.match(pattern) ?? [];
    for (const match of matches) facts.push(normalizeText(match));
  }

  const standards = cleaned.match(/\b(?:ISO\s*\d+(?:-\d+)?)\b|\b(?:IEC\s*\d+(?:-\d+)?)\b|\bNIS2\b|\bGDPR\b/gi) ?? [];
  for (const standard of standards) facts.push(normalizeText(standard));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const trimmed = fact.trim();
    if (trimmed && !seen.has(trimmed)) {
      unique.push(trimmed);
      seen.add(trimmed);
    }
  }
  return unique;
}

export function factMetrics(expected: string, generated: string): {
  factRecall: number;
  factPrecision: number;
  expectedFacts: string[];
  generatedFacts: string[];
  matchedFacts: string[];
} {
  const expectedFacts = extractFacts(expected);
  const generatedFacts = extractFacts(generated);
  const expectedSet = new Set(expectedFacts);
  const generatedSet = new Set(generatedFacts);

  let factRecall: number;
  if (expectedSet.size === 0) {
    factRecall = 1.0;
  } else {
    const found = [...expectedSet].filter((fact) => generatedSet.has(fact)).length;
    factRecall = found / expectedSet.size;
  }

  let factPrecision: number;
  if (generatedSet.size === 0) {
    factPrecision = expectedSet.size === 0 ? 1.0 : 0.0;
  } else {
    const correct = [...expectedSet].filter((fact) => generatedSet.has(fact)).length;
    factPrecision = correct / generatedSet.size;
  }

  const matchedFacts = [...expectedSet].filter((fact) => generatedSet.has(fact)).sort();

  return {
    factRecall: round4(factRecall),
    factPrecision: round4(factPrecision),
    expectedFacts,
    generatedFacts,
    matchedFacts,
  };
}

export function deterministicAnswerCorrectness(expected: string, generated: string): number {
  const expectedFacts = extractFacts(expected);
  const generatedFacts = extractFacts(generated);

  if (expectedFacts.length > 0) {
    const expectedSet = new Set(expectedFacts);
    const generatedSet = new Set(generatedFacts);
    const matched = [...expectedSet].filter((fact) => generatedSet.has(fact));
    return round4(matched.length / expectedSet.size);
  }

  const expectedTokens = new Set(tokenize(expected));
  const generatedTokens = new Set(tokenize(generated));
  if (expectedTokens.size === 0) {
    return generatedTokens.size === 0 ? 1.0 : 0.0;
  }
  return round4([...expectedTokens].filter((token) => generatedTokens.has(token)).length / expectedTokens.size);
}

// ----------------------------------------------------------------
// Answer metrics
// ----------------------------------------------------------------

export function buildAnswerMetrics(expected: string, generated: string): AnswerMetrics {
  const tok = tokenOverlapMetrics(expected, generated);
  const similarity = semanticSimilarity(expected, generated);
  const facts = factMetrics(expected, generated);
  const answerCorrectness = deterministicAnswerCorrectness(expected, generated);
  const answerQuality = round4(
    0.6 * answerCorrectness + 0.2 * facts.factRecall + 0.1 * facts.factPrecision + 0.1 * similarity,
  );

  return {
    token_recall: tok.recall,
    token_precision: tok.precision,
    f1: tok.f1,
    semantic_similarity: similarity,
    fact_recall: facts.factRecall,
    fact_precision: facts.factPrecision,
    expected_facts: facts.expectedFacts,
    generated_facts: facts.generatedFacts,
    matched_facts: facts.matchedFacts,
    answer_correctness: answerCorrectness,
    answer_quality: answerQuality,
    exact_match: answerCorrectness >= 0.9,
    expected_answer_clean: expected,
    generated_answer_clean: generated,
  };
}

// ----------------------------------------------------------------
// Retrieval extraction
// ----------------------------------------------------------------

export function normalizeFilename(name: string | null | undefined): string {
  if (!name) {
    return '';
  }
  return name.replace(/_/g, ' ').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function uniquePreserveOrder(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      result.push(value);
      seen.add(key);
    }
  }
  return result;
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

export function extractPdfNames(values: Iterable<unknown>): string[] {
  const observed: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const serialized = serializeValue(value);
    const matches = serialized.match(PDF_NAME_PATTERN) ?? [];
    for (const match of matches) {
      const fileName = match.trim();
      const key = fileName.toLowerCase();
      if (!seen.has(key)) {
        observed.push(fileName);
        seen.add(key);
      }
    }
  }
  return observed;
}

export function extractPageNumbers(value: unknown): number[] {
  const pages: number[] = [];

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(obj)) {
      if (PAGE_KEYWORDS.has(key.toLowerCase())) {
        if (typeof child === 'number' && Number.isInteger(child)) {
          pages.push(child);
        } else if (typeof child === 'string') {
          const matches = child.match(/\d+/g) ?? [];
          pages.push(...matches.map((item) => Number(item)));
        } else if (Array.isArray(child)) {
          for (const item of child) {
            const parsed = Number(item);
            if (Number.isInteger(parsed)) pages.push(parsed);
          }
        }
      } else {
        pages.push(...extractPageNumbers(child));
      }
    }
    return pages;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      pages.push(...extractPageNumbers(item));
    }
    return pages;
  }

  if (typeof value === 'string') {
    const patterns = [
      /\bpage(?:\s+number)?\s*[:=#-]?\s*(\d+)\b/gi,
      /\bpages?\s*[:=#-]?\s*\[?\s*(\d+)\s*\]?/gi,
      /\bpage_number\s*[:=]\s*(\d+)\b/gi,
      /\bpage_num(?:ber)?\s*[:=]\s*(\d+)\b/gi,
    ];
    for (const pattern of patterns) {
      const matches = value.match(pattern) ?? [];
      for (const match of matches) {
        const m = /\d+/.exec(match);
        if (m) pages.push(Number(m[0]));
      }
    }
  }

  return pages;
}

function decodeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let current: unknown = value.trim();
  for (let i = 0; i < 3; i++) {
    if (typeof current !== 'string') break;
    try {
      const decoded: unknown = JSON.parse(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function extractPagesFromValue(value: unknown): number[] {
  const decoded = decodeValue(value);
  if (decoded === null || decoded === undefined) return [];
  if (typeof decoded === 'boolean') return [];
  if (typeof decoded === 'number') return Number.isInteger(decoded) ? [decoded] : [];
  if (Array.isArray(decoded)) {
    const pages: number[] = [];
    for (const item of decoded) pages.push(...extractPagesFromValue(item));
    return pages;
  }
  if (typeof decoded === 'string') {
    const text = decoded.trim();
    if (/^\d+$/.test(text)) return [Number(text)];
    const ranges = text.match(/\b(\d+)\s*-\s*(\d+)\b/g) ?? [];
    const rangePages: number[] = [];
    for (const range of ranges) {
      const match = /(\d+)\s*-\s*(\d+)/.exec(range);
      if (match) {
        const start = Number(match[1]);
        const end = Number(match[2]);
        for (let p = start; p <= end; p++) rangePages.push(p);
      }
    }
    if (rangePages.length > 0) return rangePages;
    if (/^[\d,\s]+$/.test(text)) {
      return (text.match(/\d+/g) ?? []).map((n) => Number(n));
    }
  }
  return [];
}

function normalizePdfName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const matches = value.match(PDF_NAME_PATTERN);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].trim();
}

function addPair(pairs: FilePagePair[], seen: Set<string>, inputFileName: string, page: unknown): void {
  let normalizedFile = normalizePdfName(inputFileName);
  if (!normalizedFile) {
    if (inputFileName.toLowerCase().includes('hr policy')) normalizedFile = 'hr_policy.pdf';
    else if (inputFileName.toLowerCase().includes('employee benefits')) normalizedFile = 'employee_benefits.pdf';
    else return;
  }
  const pages = extractPagesFromValue(page);
  for (const pageNumber of pages) {
    const key = `${normalizedFile.toLowerCase()}:${String(pageNumber)}`;
    if (seen.has(key)) continue;
    pairs.push({ file: normalizedFile, page: pageNumber });
    seen.add(key);
  }
}

function extractPairsFromText(pairs: FilePagePair[], seen: Set<string>, text: string): void {
  if (!text) return;

  const tablePattern = /\|\s*([^|]+?\.(?:pdf|doc|docx)|[^|]+?)\s*\|[^\n|]*?\|\s*(?:Page\s*)?(\d+)\s*\|/gi;
  const tableMatches = text.match(tablePattern) ?? [];
  for (const tableMatch of tableMatches) {
    const match = /\|\s*([^|]+?)\s*\|[^\n|]*?\|\s*(?:Page\s*)?(\d+)\s*\|/i.exec(tableMatch);
    if (match) addPair(pairs, seen, match[1].trim(), Number(match[2]));
  }

  const textPattern = /([\w\-\s.]+\.pdf|HR Policy|Employee Benefits)((?:(?![\w\-.]+\.pdf).){0,100}?)(?:page|p\.)\s*(\d+)/gis;
  const textMatches = text.match(textPattern) ?? [];
  for (const textMatch of textMatches) {
    const match = /([\w\-\s.]+\.pdf|HR Policy|Employee Benefits)((?:(?![\w\-.]+\.pdf).){0,100}?)(?:page|p\.)\s*(\d+)/is.exec(textMatch);
    if (match) addPair(pairs, seen, match[1].trim(), Number(match[3]));
  }
}

function walkPairs(pairs: FilePagePair[], seen: Set<string>, value: unknown): void {
  const decoded = decodeValue(value);

  if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const obj = decoded as Record<string, unknown>;

    // CASE 1: citations
    const citations = decodeValue(obj.citations);
    if (Array.isArray(citations)) {
      for (const citationRaw of citations) {
        const citation = decodeValue(citationRaw);
        if (citation === null || typeof citation !== 'object' || Array.isArray(citation)) continue;
        const cit = citation as Record<string, unknown>;
        const source = cit.source ?? cit.file ?? cit.file_name ?? cit.filename;
        let page: unknown = cit.page_number ?? cit.page;
        page ??= cit.page_range;
        if (source !== null && source !== undefined) addPair(pairs, seen, serializeValue(source), page);
      }
    }

    // CASE 2: generic file + page structure
    let fileName: string | null = null;
    for (const key of ['file', 'filename', 'file_name', 'document', 'document_name', 'source']) {
      const candidate = obj[key];
      const normalized = normalizePdfName(candidate);
      if (normalized) {
        fileName = normalized;
        break;
      }
    }
    if (fileName) {
      let pageValue: unknown;
      for (const key of ['page_number', 'page', 'page_num', 'pageno', 'page_no', 'page_range']) {
        if (key in obj) {
          pageValue = obj[key];
          break;
        }
      }
      if (pageValue !== undefined) addPair(pairs, seen, fileName, pageValue);
    }

    for (const child of Object.values(obj)) walkPairs(pairs, seen, child);
    return;
  }

  if (Array.isArray(decoded)) {
    for (const item of decoded) walkPairs(pairs, seen, item);
    return;
  }

  if (typeof decoded === 'string') {
    if (decoded !== value) walkPairs(pairs, seen, decoded);
    else extractPairsFromText(pairs, seen, decoded);
  }
}

export function extractFilePagePairs(toolCalls: Record<string, unknown>[], generatedAnswer?: string | null): FilePagePair[] {
  const pairs: FilePagePair[] = [];
  const seen = new Set<string>();

  for (const call of toolCalls) {
    for (const fieldName of ['args', 'output_summary', 'result', 'output', 'content', 'response']) {
      const fieldValue = call[fieldName];
      if (fieldValue !== null && fieldValue !== undefined) walkPairs(pairs, seen, fieldValue);
    }
  }

  if (generatedAnswer) extractPairsFromText(pairs, seen, generatedAnswer);

  if (pairs.length === 0) {
    for (const call of toolCalls) {
      const values = [call.args, call.output_summary, call.result, call.output, call.content, call.response];
      const pdfNames = extractPdfNames(values);
      const pageNumbers: number[] = [];
      for (const item of values) pageNumbers.push(...extractPageNumbers(item));
      const uniquePages = Array.from(new Set(pageNumbers));
      for (const fileName of pdfNames) {
        for (const page of uniquePages) addPair(pairs, seen, fileName, page);
      }
    }
  }

  return pairs;
}

// ----------------------------------------------------------------
// Retrieval metrics
// ----------------------------------------------------------------

export function buildExpectedSources(requiredFile: unknown, page: unknown): { sources: ExpectedSource[]; error?: string } {
  const requiredFiles = (Array.isArray(requiredFile) ? requiredFile : requiredFile == null ? [] : [requiredFile])
    .map((value: unknown) => String(value).trim())
    .filter(Boolean);
  const pages = (Array.isArray(page) ? page : page == null ? [] : [page])
    .map((value: unknown) => Number(value))
    .filter((value: number) => Number.isInteger(value));

  let expectedSources: ExpectedSource[] = [];

  if (requiredFiles.length > 0 && pages.length > 0) {
    if (requiredFiles.length === pages.length) {
      expectedSources = requiredFiles.map((fileName, index) => ({ file: fileName, page: pages[index] }));
    } else if (requiredFiles.length === 1) {
      expectedSources = pages.map((pageNumber) => ({ file: requiredFiles[0], page: pageNumber }));
    } else if (pages.length === 1) {
      expectedSources = requiredFiles.map((fileName) => ({ file: fileName, page: pages[0] }));
    } else {
      return { sources: [], error: 'required_file and page must have the same length, or one side must contain exactly one value.' };
    }
  } else if (requiredFiles.length > 0) {
    expectedSources = requiredFiles.map((fileName) => ({ file: fileName, page: null }));
  } else if (pages.length > 0) {
    return { sources: [], error: 'page is specified but required_file is empty.' };
  }

  const uniqueSources: ExpectedSource[] = [];
  const seenSources = new Set<string>();
  for (const source of expectedSources) {
    const key = `${source.file.toLowerCase()}:${String(source.page)}`;
    if (!seenSources.has(key)) {
      uniqueSources.push(source);
      seenSources.add(key);
    }
  }
  return { sources: uniqueSources };
}

/** Documents the answer was actually grounded on (locate_answer_citations output). */
function extractCitedFileNames(toolCalls: ToolCall[]): string[] {
  const files: string[] = [];
  for (const call of toolCalls) {
    const output = parseJsonMaybe(call.output_summary ?? call.output ?? call.result);
    if (!output) continue;
    const list = Array.isArray(output.citations) ? output.citations : Array.isArray(output.citation_sources) ? output.citation_sources : null;
    if (!list) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const source = entry.source ?? entry.fileName ?? entry.file_name;
      if (typeof source === 'string' && source) files.push(baseName(source));
    }
  }
  return files;
}

/** Documents actually read (read_* / expand_context) when no citation is available. */
function extractReadFileNames(toolCalls: ToolCall[]): string[] {
  const values: unknown[] = [];
  for (const call of toolCalls) {
    const name = String(call.tool_name || call.name || '').toLowerCase();
    if (name.includes('read') || name.includes('expand_context')) {
      values.push(call.output_summary, call.output, call.result);
    }
  }
  return extractPdfNames(values);
}

export function buildRetrievalMetrics(
  expectedSources: ExpectedSource[],
  toolCalls: ToolCall[],
  generatedAnswer?: string | null,
): RetrievalMetrics {
  const traceValues: unknown[] = [];
  for (const call of toolCalls) {
    traceValues.push(call.args, call.output_summary, call.result, call.output);
  }
  const candidateFiles = uniquePreserveOrder(extractPdfNames(traceValues));

  // Precision must reflect the documents actually USED for the answer, not every
  // candidate a search merely surfaced. Prefer cited documents, then documents
  // that were read; fall back to all candidates only when neither is available.
  const citedFiles = uniquePreserveOrder(extractCitedFileNames(toolCalls));
  const readFiles = citedFiles.length === 0 ? uniquePreserveOrder(extractReadFileNames(toolCalls)) : [];
  const retrievedFiles = citedFiles.length > 0 ? citedFiles : readFiles.length > 0 ? readFiles : candidateFiles;
  const retrievedKeys = new Set(retrievedFiles.map(normalizeFilename));

  const expectedFiles = uniquePreserveOrder(expectedSources.map((source) => source.file));

  const requiredFilesFound = expectedFiles.filter((fileName) => retrievedKeys.has(normalizeFilename(fileName)));

  const retrievedSources = extractFilePagePairs(toolCalls, generatedAnswer);

  for (const source of retrievedSources) {
    const fileName = source.file;
    if (!fileName) continue;
    const normalizedName = normalizeFilename(fileName);
    if (!retrievedKeys.has(normalizedName)) {
      retrievedFiles.push(fileName);
      retrievedKeys.add(normalizedName);
    }
  }

  const retrievedPages = [...new Set(retrievedSources.map((source) => source.page))].sort((a, b) => a - b);

  const retrievedSourceKeys = new Set(
    retrievedSources.map((source) => `${normalizeFilename(source.file)}:${String(source.page)}`),
  );

  const matchedSources: ExpectedSource[] = [];
  for (const expectedSource of expectedSources) {
    const expectedFile = expectedSource.file;
    const expectedPage = expectedSource.page;
    if (expectedPage === null) {
      if (retrievedKeys.has(normalizeFilename(expectedFile))) matchedSources.push(expectedSource);
    } else {
      const key = `${normalizeFilename(expectedFile)}:${String(expectedPage)}`;
      if (retrievedSourceKeys.has(key)) matchedSources.push(expectedSource);
    }
  }

  const matchedSourceCount = matchedSources.length;

  let fileRecall: number;
  if (expectedFiles.length > 0) {
    fileRecall = requiredFilesFound.length / expectedFiles.length;
  } else {
    fileRecall = 1.0;
  }

  let filePrecision: number;
  if (retrievedFiles.length > 0) {
    filePrecision = expectedFiles.length > 0 ? requiredFilesFound.length / retrievedFiles.length : 0.0;
  } else {
    filePrecision = expectedFiles.length === 0 ? 1.0 : 0.0;
  }

  let pageHitCount: number;
  let pageHit: boolean;
  if (expectedSources.length > 0) {
    pageHitCount = matchedSourceCount / expectedSources.length;
    pageHit = matchedSourceCount === expectedSources.length;
  } else {
    pageHitCount = 1.0;
    pageHit = true;
  }

  const retrievalSuccess = requiredFilesFound.length === expectedFiles.length
    && pageHit
    && (expectedFiles.length > 0 || retrievedFiles.length === 0);

  return {
    expected_files: expectedFiles,
    expected_sources: expectedSources,
    retrieved_files: retrievedFiles,
    retrieved_count: retrievedFiles.length,
    retrieved_candidate_count: candidateFiles.length,
    retrieved_pages: retrievedPages,
    retrieved_sources: retrievedSources,
    required_files_found: requiredFilesFound,
    matched_sources: matchedSources,
    file_recall: round4(fileRecall),
    file_precision: round4(filePrecision),
    page_hit_count: round4(pageHitCount),
    page_hit: pageHit,
    retrieval_success: retrievalSuccess,
    exact_match: retrievalSuccess,
  };
}

// ----------------------------------------------------------------
// Per-query + summary builders
// ----------------------------------------------------------------

export interface EvaluationTokenUsage {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  [key: string]: unknown;
}

export interface EvaluationQueryResult {
  query_id: string;
  query: string;
  expected_answer: string;
  required_file: unknown;
  page: unknown;
  generated_answer: string;
  status: string;
  duration_ms: number;
  target_duration_ms?: number;
  judge_duration_ms?: number;
  error?: string | null;
  metrics: Metrics;
  retrieved_files: string[];
  retrieved_pages: number[];
  retrieved_sources: FilePagePair[];
  tool_calls?: ToolCall[];
  // `token_usage` is the global total (target + judge); the split fields let the
  // export attribute consumption to each node.
  token_usage?: EvaluationTokenUsage;
  target_token_usage?: EvaluationTokenUsage;
  judge_token_usage?: EvaluationTokenUsage;
  judge_score?: number;
  judge_faithfulness_score?: number;
  judge_reasoning?: string;
  citations?: EvaluationCitation[];
}

export interface EvaluationCitation {
  reference: number;
  fileName: string;
  page?: number;
  snippet: string;
  source?: string;
}

function parseJsonMaybe(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function citationReference(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = citationReference(item);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
  }
  return null;
}

function baseName(source: string): string {
  return source.split(/[\\/]/).filter(Boolean).at(-1) ?? source;
}

/**
 * Extract the citations the target agent grounded its answer on, from the
 * `locate_answer_citations` tool call captured in the trace. Falls back to
 * `citation_sources`, then to the tool call arguments.
 */
/**
 * Tool names are truncated/hashed when `{connector_slug}_{action_key}` exceeds
 * 64 chars (e.g. `...-no-document-strategy_lo_<hash>`), so detect the citation
 * call by its payload rather than by name.
 */
function isCitationCall(call: ToolCall): boolean {
  if (String(call['tool_name'] || call['name'] || '').includes('locate')) return true;
  const output = parseJsonMaybe(call['output_summary'] ?? call['output'] ?? call['result']);
  if (output && (Array.isArray(output['citations']) || Array.isArray(output['citation_sources']))) return true;
  const args = parseJsonMaybe(call['args'] ?? call['input']);
  return Boolean(args && Array.isArray(args['citations']));
}

function toolCallDurationMs(call: ToolCall): number | null {
  const raw = call['duration_ms'] ?? call['execution_time'];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** The answer-producing tool call: citation call, else last search/read call. */
function findAnswerToolCall(toolCalls: ToolCall[]): ToolCall | null {
  const reversed = [...toolCalls].reverse();
  return reversed.find(isCitationCall) ?? reversed.find((call) => {
    const name = String(call['tool_name'] || call['name'] || '').toLowerCase();
    return name.includes('search') || name.includes('read') || name.includes('retriev');
  }) ?? null;
}

/**
 * Sum of tool call durations for a query, excluding the answer-producing tool
 * (reported separately by {@link answerToolDurationMs}).
 */
export function toolCallsDurationMs(toolCalls: ToolCall[]): number {
  const answerCall = findAnswerToolCall(toolCalls);
  let total = 0;
  for (const call of toolCalls) {
    if (call === answerCall) continue;
    const value = toolCallDurationMs(call);
    if (value !== null && value > 0) total += value;
  }
  return total;
}

/** Duration of the answer-producing tool (citation call, else last search/read). */
export function answerToolDurationMs(toolCalls: ToolCall[]): number | null {
  const answerCall = findAnswerToolCall(toolCalls);
  return answerCall ? toolCallDurationMs(answerCall) : null;
}

export function buildCitations(toolCalls: ToolCall[]): EvaluationCitation[] {
  const locate = [...toolCalls].reverse().find(isCitationCall);
  if (!locate) return [];

  const output = parseJsonMaybe(locate['output_summary'] ?? locate['output'] ?? locate['result']);
  const fromOutput = output && (Array.isArray(output['citations']) ? output['citations'] : output['citation_sources']);
  const rawList = Array.isArray(fromOutput)
    ? fromOutput
    : (() => {
        const args = parseJsonMaybe(locate['args'] ?? locate['input']);
        const argsCitations = args && args['citations'];
        return Array.isArray(argsCitations) ? argsCitations : [];
      })();

  const citations: EvaluationCitation[] = [];
  const seen = new Set<number>();
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const reference = citationReference(entry['reference']);
    if (reference === null || seen.has(reference)) continue;
    const source = typeof entry['source'] === 'string' ? entry['source'] : '';
    const pageValue = entry['page_number'] ?? entry['page'];
    const page = typeof pageValue === 'number' ? pageValue : Number.parseInt(String(pageValue ?? ''), 10);
    seen.add(reference);
    citations.push({
      reference,
      fileName: source ? baseName(source) : String(entry['fileName'] ?? entry['file_name'] ?? ''),
      page: Number.isFinite(page) ? page : undefined,
      snippet: String(entry['highlight_text'] ?? entry['page_content'] ?? entry['evidence_text'] ?? ''),
      source: source || undefined,
    });
  }
  return citations;
}

export function buildQueryResult(input: {
  queryId: string;
  query: string;
  expectedAnswer: string;
  requiredFile: unknown;
  page: unknown;
  generatedAnswer: string;
  status: string;
  durationMs: number;
  targetDurationMs?: number;
  judgeDurationMs?: number;
  error?: string | null;
  toolCalls: { nodeId: string; iteration: number; trace: unknown[] }[];
  tokenUsage?: EvaluationTokenUsage;
  targetTokenUsage?: EvaluationTokenUsage;
  judgeTokenUsage?: EvaluationTokenUsage;
  judgeScore?: number;
  judgeFaithfulnessScore?: number;
  judgeReasoning?: string;
}): EvaluationQueryResult {
  const toolCalls: ToolCall[] = [];
  for (const entry of input.toolCalls) {
    for (const item of entry.trace) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        toolCalls.push({ node_id: entry.nodeId, iteration: entry.iteration, ...(item as Record<string, unknown>) });
      }
    }
  }

  const { sources: expectedSources } = buildExpectedSources(input.requiredFile, input.page);
  const retrieval = buildRetrievalMetrics(expectedSources, toolCalls, input.generatedAnswer);
  const answer = buildAnswerMetrics(input.expectedAnswer, input.generatedAnswer);
  const citations = buildCitations(toolCalls);

  return {
    query_id: input.queryId,
    query: input.query,
    expected_answer: input.expectedAnswer,
    required_file: input.requiredFile,
    page: input.page,
    generated_answer: input.generatedAnswer,
    status: input.status,
    duration_ms: input.durationMs,
    target_duration_ms: input.targetDurationMs,
    judge_duration_ms: input.judgeDurationMs,
    error: input.error,
    metrics: { retrieval, answer },
    retrieved_files: retrieval.retrieved_files,
    retrieved_pages: retrieval.retrieved_pages,
    retrieved_sources: retrieval.retrieved_sources,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    citations: citations.length > 0 ? citations : undefined,
    token_usage: input.tokenUsage,
    target_token_usage: input.targetTokenUsage,
    judge_token_usage: input.judgeTokenUsage,
    judge_score: input.judgeScore,
    judge_faithfulness_score: input.judgeFaithfulnessScore,
    judge_reasoning: input.judgeReasoning,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0.0;
  return round4(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export interface EvaluationRunSummary {
  query_count: number;
  completed_queries: number;
  failed_queries: number;
  mean_answer_correctness: number;
  mean_answer_token_recall: number;
  mean_answer_token_precision: number;
  mean_answer_f1: number;
  mean_semantic_similarity: number;
  mean_fact_recall: number;
  mean_fact_precision: number;
  mean_answer_quality: number;
  answer_exact_match_rate: number;
  judge_exact_match_rate: number;
  mean_file_recall: number;
  mean_file_precision: number;
  mean_page_hit: number;
  retrieval_success_rate: number;
  retrieval_exact_match_rate: number;
}

export function buildSummary(results: EvaluationQueryResult[]): EvaluationRunSummary {
  const total = results.length;
  const answerMetricsList = results.map((r) => r.metrics.answer);
  const retrievalMetricsList = results.map((r) => r.metrics.retrieval);

  const answerExactMatches = answerMetricsList.filter((m) => m.exact_match).length;
  const retrievalSuccesses = retrievalMetricsList.filter((m) => m.retrieval_success).length;
  const retrievalExactMatches = retrievalMetricsList.filter((m) => m.exact_match).length;
  const completed = results.filter((r) => r.status === 'completed').length;
  // Judge-graded exact match: queries the LLM judge scored 1, over the queries
  // that actually received a judge score (missing scores are ignored).
  const judgeScored = results.filter(
    (r) => typeof r.judge_score === 'number' && Number.isFinite(r.judge_score),
  );
  const judgeExactMatches = judgeScored.filter((r) => r.judge_score === 1).length;

  return {
    query_count: total,
    completed_queries: completed,
    failed_queries: total - completed,
    mean_answer_correctness: mean(answerMetricsList.map((m) => m.answer_correctness)),
    mean_answer_token_recall: mean(answerMetricsList.map((m) => m.token_recall)),
    mean_answer_token_precision: mean(answerMetricsList.map((m) => m.token_precision)),
    mean_answer_f1: mean(answerMetricsList.map((m) => m.f1)),
    mean_semantic_similarity: mean(answerMetricsList.map((m) => m.semantic_similarity)),
    mean_fact_recall: mean(answerMetricsList.map((m) => m.fact_recall)),
    mean_fact_precision: mean(answerMetricsList.map((m) => m.fact_precision)),
    mean_answer_quality: mean(answerMetricsList.map((m) => m.answer_quality)),
    answer_exact_match_rate: total === 0 ? 0 : round4(answerExactMatches / total),
    judge_exact_match_rate: judgeScored.length === 0 ? 0 : round4(judgeExactMatches / judgeScored.length),
    mean_file_recall: mean(retrievalMetricsList.map((m) => m.file_recall)),
    mean_file_precision: mean(retrievalMetricsList.map((m) => m.file_precision)),
    mean_page_hit: mean(retrievalMetricsList.map((m) => m.page_hit_count)),
    retrieval_success_rate: total === 0 ? 0 : round4(retrievalSuccesses / total),
    retrieval_exact_match_rate: total === 0 ? 0 : round4(retrievalExactMatches / total),
  };
}

/**
 * Scope a benchmark to a set of query ids. An empty/absent list keeps the whole
 * dataset so the default run behavior is unchanged.
 */
export function selectBenchmarkQueries<T extends { query_id: string }>(
  queries: T[],
  queryIds?: string[],
): T[] {
  const targets = (queryIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (targets.length === 0) {
    return queries;
  }
  const wanted = new Set(targets);
  return queries.filter((query) => wanted.has(query.query_id));
}
