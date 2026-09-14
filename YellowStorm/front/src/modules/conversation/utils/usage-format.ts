export function formatCompactTokenTotal(value: number, language: string): string {
  if (value >= 1_000_000) return `${formatScaled(value / 1_000_000, language)}M tokens`;
  if (value >= 1_000) return `${formatScaled(value / 1_000, language)}K tokens`;
  return `${value.toLocaleString(language)} tokens`;
}

export function formatUsd(value: number | null, language: string): string | null {
  if (value == null) return null;
  if (value > 0 && value < 0.001) return '<$0.001';
  const digits = value < 1 ? 3 : 2;
  return `$${value.toLocaleString(language, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatCarbon(value: number | null, language: string): string | null {
  if (value == null) return null;
  if (value >= 1_000) return `≈ ${(value / 1_000).toLocaleString(language, { maximumFractionDigits: 1 })} kgCO₂e`;
  return `≈ ${value.toLocaleString(language, { maximumFractionDigits: 1 })} gCO₂e`;
}

function formatScaled(value: number, language: string): string {
  return value.toLocaleString(language, { maximumFractionDigits: 1 });
}
