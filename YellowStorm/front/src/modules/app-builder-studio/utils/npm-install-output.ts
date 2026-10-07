/** Parse `npm install` summary lines like `added 347 packages in 12.3s`. */
export function parseNpmAddedPackages(stdout: string): number | null {
  const match = stdout.match(/added\s+(\d+)\s+packages?/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}
