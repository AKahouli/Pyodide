import { defineFunction } from '@openuidev/react-lang';
import { z } from 'zod/v4';

const text = z.string().max(20_000);
const items = z.array(text).max(200).refine(
  (values) => values.reduce((length, value) => length + value.length, 0) <= 20_000,
  'Combined text exceeds 20000 characters',
);

const formatNumberParams = z.object({ value: z.number().finite(), decimals: z.number().int().min(0).max(12) });
const formattedNumber = z.string().max(512);
const textMetricsParams = z.object({ text });
const textMetrics = z.object({ characters: z.number().int(), words: z.number().int(), lines: z.number().int() });
const filterTextParams = z.object({ items, query: text });
const joinTextParams = z.object({ items, separator: z.string().max(100) });

// Validate inside every implementation: the SDK's execution path does not
// consistently enforce declared schemas. It catches validation throws as null.
export const formatNumberFunction = defineFunction({
  name: 'FormatNumber',
  description: 'Format a finite number using en-US grouping and 0–12 fixed decimal places. Invalid calls return null.',
  params: formatNumberParams,
  returns: formattedNumber,
  fn: (args) => {
    const { value, decimals } = formatNumberParams.parse(args);
    return formattedNumber.parse(new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(value));
  },
});

export const textMetricsFunction = defineFunction({
  name: 'TextMetrics',
  description: 'Count Unicode code points, whitespace-separated words and lines in text (maximum 20000 UTF-16 code units). Empty text has zero lines. Does not summarize or read documents.',
  params: textMetricsParams,
  returns: textMetrics,
  fn: (args) => {
    const { text: value } = textMetricsParams.parse(args);
    return textMetrics.parse({
      characters: Array.from(value).length,
      words: value.trim() ? value.trim().split(/\s+/u).length : 0,
      lines: value ? value.split(/\r\n|\r|\n/u).length : 0,
    });
  },
});

export const filterTextFunction = defineFunction({
  name: 'FilterText',
  description: 'Filter at most 200 strings by a case-insensitive substring, retaining original order. Combined item text and query are each limited to 20000 characters. A blank query returns all items.',
  params: filterTextParams,
  returns: items,
  fn: (args) => {
    const { items: values, query } = filterTextParams.parse(args);
    return items.parse(values.filter((value) => value.toLowerCase().includes(query.toLowerCase())));
  },
});

export const joinTextFunction = defineFunction({
  name: 'JoinText',
  description: 'Join at most 200 strings with a separator (maximum 100 characters). Combined input and output text cannot exceed 20000 characters. Invalid calls return null.',
  params: joinTextParams,
  returns: text,
  fn: (args) => {
    const { items: values, separator } = joinTextParams.parse(args);
    return text.parse(values.join(separator));
  },
});

export const miniAppFunctions = [formatNumberFunction, textMetricsFunction, filterTextFunction, joinTextFunction];
