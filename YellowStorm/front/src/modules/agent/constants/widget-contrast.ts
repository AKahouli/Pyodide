export function getRelativeLuminance(hex: string): number | null {
  const channels = parseHex(hex);
  if (!channels) return null;
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function getContrastRatio(foreground: string, background: string): number | null {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

export function isTextContrastCompliant(foreground: string, background: string, minimum = 4.5): boolean {
  const ratio = getContrastRatio(foreground, background);
  return ratio !== null && ratio >= minimum;
}

export function isUiContrastCompliant(foreground: string, background: string, minimum = 3): boolean {
  return isTextContrastCompliant(foreground, background, minimum);
}

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return null;
  const normalized = value.length === 3 ? value.split('').map((channel) => channel + channel).join('') : value;
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number];
}
