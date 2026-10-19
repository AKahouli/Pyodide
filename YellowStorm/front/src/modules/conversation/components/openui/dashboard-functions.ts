import { defineFunction } from "@openuidev/react-lang";
import { z } from "zod/v4";

// Adapted from thesysdev/open-intelligent-ui, MIT, revision 03213439358bf3408ad61a46ec9e3230c5572e48.
const MAX_ITEMS = 200;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function safeKey(key: string) { if (forbidden.has(key)) throw new Error('Unsafe key'); }
const fieldPath = z.string().max(200).refine((value) => value.split('.').every((key) => !forbidden.has(key)), 'Unsafe field');
const writableField = fieldPath.refine((value) => !value.includes('.'), 'Running transforms require a top-level field or empty field');
const scalar = z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.null()]);
// Bound nested source rows as well as output, before any grouping or arithmetic.
function validateData(value: unknown) {
  let nodes = 0;
  let chars = 0;
  function visit(item: unknown, depth: number) {
    if (++nodes > 5000 || depth > 8) throw new Error('Dashboard data too complex');
    if (typeof item === 'string') { chars += item.length; if (chars > 20_000) throw new Error('Dashboard text too long'); return; }
    if (typeof item === 'number') { finite(item); return; }
    if (item === null || typeof item === 'boolean') return;
    if (!item || typeof item !== 'object') throw new Error('Expected JSON data');
    if (Array.isArray(item)) { if (item.length > MAX_ITEMS) throw new Error('Too many items'); item.forEach((v) => visit(v, depth + 1)); return; }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('Expected own JSON properties');
    for (const key of Object.keys(item)) { safeKey(key); chars += key.length; const descriptor = Object.getOwnPropertyDescriptor(item, key); if (!descriptor || !('value' in descriptor)) throw new Error('Accessor not allowed'); visit(descriptor.value, depth + 1); }
  }
  visit(value, 0);
  if (chars > 20_000) throw new Error('Dashboard text too long');
}
const list = () => z.array(z.unknown()).max(MAX_ITEMS).superRefine((value, ctx) => { try { validateData(value); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid or excessive dashboard data' }); } });
const numbers = () => z.array(z.number().finite()).max(MAX_ITEMS);
const agg = () => z.enum(['sum', 'avg', 'count', 'min', 'max']);
type Agg = z.infer<ReturnType<typeof agg>>;
function finite(value: number) { if (!Number.isFinite(value)) throw new Error('Nonfinite result'); return value; }
function toNum(value: unknown): number | null { if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function read(item: unknown, field: string): unknown {
  if (!field) return item;
  let current = item;
  for (const key of field.split('.')) {
    safeKey(key);
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function groups(rows: unknown[], key: string) {
  const out = new Map<string | number, unknown[]>();
  for (const row of rows) { const raw = read(row, key); const k = typeof raw === 'number' ? raw : raw == null || raw === '' ? 'Unknown' : String(raw); const bucket = out.get(k); if (bucket) bucket.push(row); else out.set(k, [row]); }
  return out;
}
function aggregate(rows: unknown[], field: string | undefined, how: Agg) {
  if (how === 'count') return rows.length;
  const values = rows.map((row) => toNum(read(row, field ?? ''))).filter((value): value is number => value !== null);
  if (!values.length) return 0;
  if (how === 'min') return Math.min(...values);
  if (how === 'max') return Math.max(...values);
  return finite(values.reduce((a, b) => finite(a + b), 0) / (how === 'avg' ? values.length : 1));
}
function validatedFunction<P extends z.ZodObject, R extends z.ZodType>(config: { name: string; description: string; params: P; returns: R; fn: (args: z.infer<P>) => z.infer<R> }) {
  // The installed SDK uses a conditional Zod output type; runtime schemas remain authoritative.
  const execute = (args: z.infer<P>) => {
    const result = config.fn(config.params.parse(args));
    validateData(result);
    return config.returns.parse(result);
  };
  return defineFunction({ ...config, fn: execute as Parameters<typeof defineFunction<P, R>>[0]["fn"] });
}
const DAY = 86_400_000;
function parseDate(value: string | number): { day: number } {
  // UTC intentionally makes persisted dashboard buckets independent of viewer timezone.
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw new Error('Expected ISO date');
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.getUTCFullYear() < 100 || instant.getUTCFullYear() > 9999) throw new Error('Invalid date');
  if (typeof value === 'string' && value.length === 10 && instant.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return { day: Math.floor(instant.getTime() / DAY) };
}
function isoDay(day: number) { return new Date(day * DAY).toISOString().slice(0, 10); }

const keyValue = () => z.array(z.object({ key: z.union([z.string(), z.number()]), value: z.number() }));
// Untyped arrays (a pluck over rows that lack the field) can still hold nulls
const finiteOnly = (values: unknown[]) => values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
const defaultAgg = (field: string | undefined, how: Agg | undefined): Agg => how ?? (field ? "sum" : "count");

/** Copy of each row with `field` replaced; field "" maps a list of numbers. */
function mapField(rows: unknown[], field: string, values: number[]): unknown[] {
  return rows.map((row, i) => (field ? { ...(row as object), [field]: values[i] } : values[i]));
}

export const GroupBy = validatedFunction({
  name: "GroupBy",
  description:
    'One row per distinct key, in first-seen order; value is agg of field (default "sum"), or the row count without a field',
  params: z.object({ rows: list(), key: fieldPath, field: fieldPath.optional(), agg: agg().optional() }),
  returns: keyValue(),
  fn: ({ rows, key, field, agg: how }) =>
    [...groups(rows, key)].map(([k, members]) => ({ key: k, value: aggregate(members, field, defaultAgg(field, how)) })),
});

export const Pivot = validatedFunction({
  name: "Pivot",
  description: "One row per rowKey value with a column per colKey value holding agg of field, for stacked or grouped charts",
  params: z.object({
    rows: list(),
    rowKey: fieldPath,
    colKey: fieldPath,
    field: fieldPath.optional(),
    agg: agg().optional(),
  }),
  returns: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
  fn: ({ rows, rowKey, colKey, field, agg: how }) => {
    const cols = [...groups(rows, colKey).keys()].map(String);
    return [...groups(rows, rowKey)].map(([k, members]) => {
      const out: Record<string, string | number> = { key: k };
      for (const col of cols) { safeKey(col); if (col === "key") throw new Error("Pivot column conflicts with key"); out[col] = 0; }
      for (const [c, cell] of groups(members, colKey)) out[String(c)] = aggregate(cell, field, defaultAgg(field, how));
      return out;
    });
  },
});

export const Top = validatedFunction({
  name: "Top",
  description: 'The n rows with the largest field ("asc": the smallest)',
  params: z.object({ rows: list(), field: fieldPath, n: z.number().int().min(0).max(MAX_ITEMS), direction: z.enum(["desc", "asc"]).optional() }),
  returns: list(),
  fn: ({ rows, field, n, direction = "desc" }) => {
    const sign = direction === "asc" ? 1 : -1;
    const ranked = rows
      .map((row, i) => ({ row, i, v: toNum(read(row, field)) }))
      .sort((a, b) => {
        if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
        return (a.v - b.v) * sign || a.i - b.i;
      });
    return ranked.slice(0, Math.max(0, Math.trunc(n))).map((r) => r.row);
  },
});

/** Orders two field values: numbers by value, anything else (such as "YYYY-MM-DD") as text. */
function compare(a: unknown, b: unknown): number {
  const x = toNum(a);
  const y = toNum(b);
  if (x !== null && y !== null) return x - y;
  const s = String(a);
  const t = String(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

export const Between = validatedFunction({
  name: "Between",
  description:
    'Rows whose field is from min to max, both included; compares numbers, or text such as "YYYY-MM-DD" dates. Leave min or max null for an open end',
  params: z.object({ rows: list(), field: fieldPath, min: scalar.optional(), max: scalar.optional() }),
  returns: list(),
  fn: ({ rows, field, min, max }) =>
    rows.filter((row) => {
      const v = read(row, field);
      if (v == null) return false;
      return (min == null || compare(v, min) >= 0) && (max == null || compare(v, max) <= 0);
    }),
});

function periodStart(day: number, unit: "day" | "week" | "month"): number {
  if (unit === "day") return day;
  if (unit === "week") return day - ((new Date(day * 86_400_000).getUTCDay() + 6) % 7); // Monday
  const d = new Date(day * 86_400_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86_400_000;
}

function nextPeriod(start: number, unit: "day" | "week" | "month"): number {
  if (unit === "day") return start + 1;
  if (unit === "week") return start + 7;
  const d = new Date(start * 86_400_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86_400_000;
}

export const Bucket = validatedFunction({
  name: "Bucket",
  description:
    'Rows per day, week (from Monday) or month of dateField, in date order, empty periods 0 for sum and count; key is "YYYY-MM-DD", or "YYYY-MM" for months',
  params: z.object({
    rows: list(),
    dateField: fieldPath,
    unit: z.enum(["day", "week", "month"]),
    field: fieldPath.optional(),
    agg: agg().optional(),
  }),
  returns: keyValue(),
  fn: ({ rows, dateField, unit, field, agg: how }) => {
    const byPeriod = new Map<number, unknown[]>();
    for (const row of rows) {
      const raw = read(row, dateField);
      if (typeof raw !== "string" && typeof raw !== "number") continue;
      let day: number;
      try {
        day = parseDate(raw).day;
      } catch {
        continue;
      }
      const start = periodStart(day, unit);
      const bucket = byPeriod.get(start);
      if (bucket) bucket.push(row);
      else byPeriod.set(start, [row]);
    }
    if (!byPeriod.size) return [];
    const mode = defaultAgg(field, how);
    const fill = mode === "sum" || mode === "count";
    const label = (start: number) => (unit === "month" ? isoDay(start).slice(0, 7) : isoDay(start));
    const starts = [...byPeriod.keys()].sort((a, b) => a - b);
    const out: { key: string; value: number }[] = [];
    let iterations = 0;
    for (let s = starts[0]!; s <= starts[starts.length - 1]!; s = nextPeriod(s, unit)) {
      if (++iterations > MAX_ITEMS) throw new Error("more than 200 periods");
      const members = byPeriod.get(s);
      if (members) out.push({ key: label(s), value: aggregate(members, field, mode) });
      else if (fill) out.push({ key: label(s), value: 0 });
      if (out.length > MAX_ITEMS) throw new Error(`more than ${MAX_ITEMS} periods`);
    }
    return out;
  },
});

export const Cumulative = validatedFunction({
  name: "Cumulative",
  description: 'Copy of the rows with a top-level field replaced by its running total (field "" for a list of numbers). Dotted paths are rejected',
  params: z.object({ rows: list(), field: writableField }),
  returns: list(),
  fn: ({ rows, field }) => {
    let total = 0;
    return mapField(rows, field, rows.map((row) => (total += toNum(read(row, field)) ?? 0)));
  },
});

export const MovingAvg = validatedFunction({
  name: "MovingAvg",
  description: 'Copy of the rows with a top-level field replaced by the average of its last window values (field "" for a list of numbers). Dotted paths are rejected',
  params: z.object({ rows: list(), field: writableField, window: z.number().int().min(1).max(MAX_ITEMS) }),
  returns: list(),
  fn: ({ rows, field, window }) => {
    const w = Math.trunc(window);
    if (w < 1) throw new Error("window must be at least 1");
    const values = rows.map((row) => toNum(read(row, field)) ?? 0);
    const averages = values.map((_, i) => {
      const span = values.slice(Math.max(0, i - w + 1), i + 1);
      return span.reduce((a, b) => a + b, 0) / span.length;
    });
    return mapField(rows, field, averages);
  },
});

export const Change = validatedFunction({
  name: "Change",
  description: "Percent change from previous to current, e.g. @Change(120, 100) is 20; null when previous is 0",
  params: z.object({ current: z.number().finite(), previous: z.number().finite() }),
  returns: z.number().finite().nullable(),
  // No previous value is normal while data loads, so it is null without an error
  fn: ({ current, previous }) => (previous === 0 ? null : finite(((current - previous) / Math.abs(previous)) * 100)),
});

export const Histogram = validatedFunction({
  name: "Histogram",
  description:
    "Counts numbers into equal-width bins (value is the count); min and max fix the range, default the data's",
  params: z.object({ values: numbers(), bins: z.number().int().min(1).max(MAX_ITEMS), min: z.number().finite().optional(), max: z.number().finite().optional() }),
  returns: z.array(z.object({ key: z.string(), value: z.number().int().min(0).max(MAX_ITEMS), start: z.number().finite(), end: z.number().finite() })),
  fn: ({ values: raw, bins, min, max }) => {
    const values = finiteOnly(raw);
    const n = Math.trunc(bins);
    if (n < 1 || n > MAX_ITEMS) throw new Error("bins must be from 1 to 200");
    const lo = min ?? (values.length ? Math.min(...values) : 0);
    let hi = max ?? (values.length ? Math.max(...values) : 1);
    if (hi <= lo) hi = lo + 1;
    const width = finite((hi - lo) / n);
    if (width <= 0) throw new Error("Histogram range has no representable width");
    const decimals = Math.min(100, Math.max(0, 1 - Math.floor(Math.log10(width))));
    const counts = new Array<number>(n).fill(0);
    for (const v of values) {
      if (v < lo || v > hi) continue;
      counts[Math.min(n - 1, Math.floor((v - lo) / width))]!++;
    }
    return counts.map((value, i) => {
      const start = lo + i * width;
      return { key: String(Number(start.toFixed(decimals))), value, start, end: start + width };
    });
  },
});

export const Stats = validatedFunction({
  name: "Stats",
  description: "Summary of numbers, all zeros for an empty list",
  params: z.object({ values: numbers() }),
  returns: z.object({
    count: z.number().int().min(0).max(MAX_ITEMS),
    min: z.number().finite(),
    max: z.number().finite(),
    mean: z.number().finite(),
    median: z.number().finite(),
    stdev: z.number().finite().nonnegative(),
  }),
  fn: ({ values: raw }) => {
    const values = finiteOnly(raw);
    const count = values.length;
    if (!count) return { count: 0, min: 0, max: 0, mean: 0, median: 0, stdev: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / count;
    const mid = Math.floor(count / 2);
    const median = count % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const stdev = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / count);
    return { count, min: sorted[0]!, max: sorted[count - 1]!, mean, median, stdev };
  },
});

export const dashboardFunctions = [GroupBy, Pivot, Top, Between, Bucket, Cumulative, MovingAvg, Change, Histogram, Stats];
