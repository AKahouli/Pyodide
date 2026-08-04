/** Read a concrete next version (x.y.z) from package.json dependency ranges. */
export function readNextVersionFromPackageJson(raw: string): string | null {
  try {
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const next = pkg.dependencies?.next ?? pkg.devDependencies?.next;
    if (!next) return null;
    const match = next.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
