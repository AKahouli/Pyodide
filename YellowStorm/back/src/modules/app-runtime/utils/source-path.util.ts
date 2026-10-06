/**
 * Extensions treated as UTF-8 text when committing / hydrating revisions.
 * Mirrors `front/.../utils/app-source.ts` — keep in sync.
 */
const TEXT_SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|sass|less|html?|svg|txt|yml|yaml|toml|env|gitignore|npmrc|prettierrc|eslintrc)$/i;

export function isTextSourcePath(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return TEXT_SOURCE_EXT.test(path) || name === 'Dockerfile' || name.startsWith('.');
}
