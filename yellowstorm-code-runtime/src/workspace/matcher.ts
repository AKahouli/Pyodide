import type { ResolvedFile } from "./types.js";

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function staticGlobRoot(pattern: string): string {
  const wildcard = pattern.search(/[?*\[]/);
  if (wildcard < 0) return pattern.includes("/") ? pattern.slice(0, pattern.lastIndexOf("/")) : pattern;
  const slash = pattern.lastIndexOf("/", wildcard);
  return slash > 0 ? pattern.slice(0, slash) : "/workspace";
}

export function globMatcher(pattern: string): (path: string) => boolean {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*" && pattern[index + 1] === "*") {
      expression += pattern[index + 2] === "/" ? "(?:.*/)?" : ".*";
      index += pattern[index + 2] === "/" ? 2 : 1;
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += escapeRegex(char);
  }
  const regex = new RegExp(`^${expression}$`, "i");
  return (path) => regex.test(path);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let matches = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      matches += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * matches) / (left.length + right.length - 2);
}

function score(file: ResolvedFile, query: string): number {
  const raw = query.trim().toLowerCase();
  const terms = normalized(raw).split(" ").filter((term) => term && term !== "latest" && term !== "newest");
  const name = file.name.toLowerCase();
  const normalizedName = normalized(file.name);
  const normalizedQuery = terms.join(" ");
  if (name === raw) return 1_000;
  if (normalizedName === normalizedQuery && normalizedQuery) return 900;
  if (terms.length && terms.every((term) => normalizedName.includes(term))) return 700;
  const path = normalized(file.path);
  if (terms.length && terms.every((term) => path.includes(term))) return 500;
  const nameTerms = normalizedName.split(" ").filter(Boolean);
  const tokenSimilarity = terms.length
    ? terms.reduce((sum, term) => sum + Math.max(0, ...nameTerms.map((candidate) => diceSimilarity(term, candidate))), 0) / terms.length
    : 0;
  if (tokenSimilarity >= 0.55) return 200 + tokenSimilarity;
  const similarity = diceSimilarity(normalizedName, normalizedQuery);
  return similarity >= 0.55 ? 100 + similarity : 0;
}

export function rankFiles(files: ResolvedFile[], query: string): ResolvedFile[] {
  const recency = /\b(?:latest|newest|most recent)\b/i.test(query);
  return files
    .map((file) => ({ file, score: score(file, query) }))
    .filter((item) => item.score > 0 || (recency && !query.replace(/\b(?:latest|newest|most recent)\b/gi, "").trim()))
    .sort((left, right) =>
      right.score - left.score
      || (recency ? Date.parse(right.file.modifiedAt ?? "") - Date.parse(left.file.modifiedAt ?? "") : 0)
      || left.file.path.localeCompare(right.file.path)
    )
    .map((item) => item.file);
}
