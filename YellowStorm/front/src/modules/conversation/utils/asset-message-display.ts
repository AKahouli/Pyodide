/** Display-only recognition of selectors produced by the composer. Never grants access. */
export interface DisplayAssetTag { name: string; ref: string }
function isAssetRef(ref: string): boolean {
  try {
    const parts: unknown = JSON.parse(atob(ref.replace(/-/g, '+').replace(/_/g, '/')));
    return Array.isArray(parts) && parts.length === 3 && ['document', 'artifact', 'app'].includes(parts[0])
      && parts.every(part => typeof part === 'string' && part.length > 0 && part.length <= 128);
  } catch { return false; }
}
export function assetMessageDisplay(content: string): { text: string; assets: DisplayAssetTag[] } {
  const lines = content.split(/\r?\n/);
  let end = lines.length;
  while (end && !lines[end - 1].trim()) end--;
  const assets: DisplayAssetTag[] = [];
  while (end) {
    const match = /^(?:Use this conversation asset: |Utiliser ce contenu de la conversation : )(.{1,1000}) \[([A-Za-z0-9_-]{1,2048})\]$/.exec(lines[end - 1]);
    if (!match || !match[1].trim() || !isAssetRef(match[2])) break;
    assets.unshift({ name: match[1], ref: match[2] }); end--;
  }
  if (!assets.length) return { text: content, assets };
  return { text: lines.slice(0, end).join('\n').trimEnd(), assets };
}
