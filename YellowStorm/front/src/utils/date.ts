const DEFAULT_LOCALE = 'en';

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();
const fullDateFormatters = new Map<string, Intl.DateTimeFormat>();

const RELATIVE_TIME_DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Infinity, unit: 'year' },
];

const getRelativeTimeFormatter = (locale?: string) => {
  const resolvedLocale = locale || DEFAULT_LOCALE;
  if (!relativeTimeFormatters.has(resolvedLocale)) {
    relativeTimeFormatters.set(resolvedLocale, new Intl.RelativeTimeFormat(resolvedLocale, { numeric: 'auto' }));
  }
  return relativeTimeFormatters.get(resolvedLocale)!;
};

const getShortDateFormatter = (locale?: string) => {
  const resolvedLocale = locale || DEFAULT_LOCALE;
  if (!shortDateFormatters.has(resolvedLocale)) {
    shortDateFormatters.set(resolvedLocale, new Intl.DateTimeFormat(resolvedLocale, { month: 'short', day: 'numeric' }));
  }
  return shortDateFormatters.get(resolvedLocale)!;
};

const getFullDateFormatter = (locale?: string) => {
  const resolvedLocale = locale || DEFAULT_LOCALE;
  if (!fullDateFormatters.has(resolvedLocale)) {
    fullDateFormatters.set(resolvedLocale, new Intl.DateTimeFormat(resolvedLocale, { month: 'short', day: 'numeric', year: 'numeric' }));
  }
  return fullDateFormatters.get(resolvedLocale)!;
};

export const formatRelativeTimeLabel = (value: string | null, fallback = '', locale?: string) => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  let duration = (date.getTime() - Date.now()) / 1000;
  const formatter = getRelativeTimeFormatter(locale);

  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount || division.amount === Infinity) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }

  return getShortDateFormatter(locale).format(date);
};

export const formatFullDateLabel = (value: string, fallback = '', locale?: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return getFullDateFormatter(locale).format(date);
};

export const formatShortDateLabel = (value: string, fallback = '', locale?: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return getShortDateFormatter(locale).format(date);
};
