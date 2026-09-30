import { checkManagedFileConformance } from './platform-conformance';
import {
  APP_ENTRY_CANDIDATES,
  APP_ROOT_CANDIDATES,
  buildPlatformManifest,
  PLATFORM_KIT_FILES,
  PLATFORM_MANIFEST_PATH,
  readPlatformKitFile,
  serializePlatformManifest,
} from './platform-kit';
import { DEFAULT_TSCONFIG, DEFAULT_VITE_CONFIG, defaultIndexHtml } from './platform-defaults';
import { planAppRoot, transformAppEntry } from './transforms/app-entry.transform';
import { transformPackageJson } from './transforms/package-json.transform';
import { transformViteConfig } from './transforms/vite-config.transform';

/**
 * `seed`: the workspace is being created from a template — platform files are
 * authoritative and overwrite whatever the template shipped.
 * `deploy`: the agent has been working — only missing files are added, and
 * modified platform files must still satisfy the runtime invariants.
 */
export type BaselineMode = 'seed' | 'deploy';

export interface BaselineFile {
  path: string;
  content: string;
}

/** Whatever holds the project files: a revision, or an uploaded template ZIP. */
export interface BaselineSource {
  paths: string[];
  read(path: string): Promise<string | null>;
}

export interface PlatformBaselinePlan {
  mode: BaselineMode;
  files: BaselineFile[];
  violations: string[];
  warnings: string[];
  entry: string;
  appRoot: string;
}

const VITE_CONFIG_RE = /^vite\.config\.(js|ts|mjs|cjs|mts|cts)$/;
const HTML_ENTRY_RE = /<script[^>]*src=["']\/?([^"']+\.[jt]sx?)["']/;

/**
 * Compute everything that must be written to turn a React/Vite project into a
 * deployable App Builder app: the Platform Kit plus the handful of files that
 * must cooperate with it (Vite config, package.json, entry, root component).
 */
export async function planPlatformBaseline(
  source: BaselineSource,
  mode: BaselineMode,
): Promise<PlatformBaselinePlan> {
  const paths = new Set(source.paths.map((path) => path.replace(/\\/g, '/')));
  const read = (path: string) => (paths.has(path) ? source.read(path) : Promise.resolve(null));

  const files: BaselineFile[] = [];
  const violations: string[] = [];
  const warnings: string[] = [];
  const add = (path: string, content: string) => files.push({ path, content });

  await planKitFiles({ mode, read, add, violations });

  const entry = await resolveEntryPath(paths, read);
  const entrySource = await read(entry);
  const entryResult = transformAppEntry(entrySource, findGlobalStylesheet(paths));
  const entryMountsRouter = Boolean(entrySource?.includes('AppRouter'));
  if ((mode === 'seed' || !entryMountsRouter) && entryResult.changed) {
    add(entry, entryResult.content);
  }

  const appRoot = await planAppRootFile({
    paths,
    read,
    detectedRoot: entryResult.detectedRoot,
    add,
    violations,
    warnings,
  });

  await planViteConfig({ paths, read, add, violations });
  await planPackageJson({ read, add, violations });
  await planTsconfig({ paths, read, add, warnings });

  if (!paths.has('index.html')) {
    add('index.html', defaultIndexHtml(entry));
  }

  const manifest = serializePlatformManifest(buildPlatformManifest({ appRoot, entry }));
  if ((await read(PLATFORM_MANIFEST_PATH)) !== manifest) {
    add(PLATFORM_MANIFEST_PATH, manifest);
  }

  return { mode, files, violations, warnings, entry, appRoot };
}

const GLOBAL_STYLESHEETS = ['src/index.css', 'src/main.css', 'src/styles.css', 'src/global.css'];

/** Fallback stylesheet when the template has no entry to copy CSS imports from. */
function findGlobalStylesheet(paths: Set<string>): string | null {
  const found = GLOBAL_STYLESHEETS.find((candidate) => paths.has(candidate));
  return found ? `./${found.slice('src/'.length)}` : null;
}

type Reader = (path: string) => Promise<string | null>;
type Adder = (path: string, content: string) => void;

async function planKitFiles(ctx: {
  mode: BaselineMode;
  read: Reader;
  add: Adder;
  violations: string[];
}): Promise<void> {
  for (const file of PLATFORM_KIT_FILES) {
    const kitContent = readPlatformKitFile(file);
    const existing = await ctx.read(file.path);

    if (existing === null) {
      ctx.add(file.path, kitContent);
      continue;
    }
    if (file.kind === 'support' || existing === kitContent) {
      continue;
    }
    if (ctx.mode === 'seed') {
      ctx.add(file.path, kitContent);
      continue;
    }
    for (const violation of checkManagedFileConformance(file.path, existing)) {
      ctx.violations.push(`${file.path}: ${violation}`);
    }
  }
}

/** `index.html` wins: it is what Vite actually loads. */
async function resolveEntryPath(paths: Set<string>, read: Reader): Promise<string> {
  const html = await read('index.html');
  const declared = html ? HTML_ENTRY_RE.exec(html)?.[1] : null;
  if (declared && paths.has(declared)) return declared;

  const existing = APP_ENTRY_CANDIDATES.find((candidate) => paths.has(candidate));
  return existing ?? declared ?? 'src/main.jsx';
}

async function planAppRootFile(ctx: {
  paths: Set<string>;
  read: Reader;
  detectedRoot: { name: string; importPath: string } | null;
  add: Adder;
  violations: string[];
  warnings: string[];
}): Promise<string> {
  const existingPath = APP_ROOT_CANDIDATES.find((candidate) => ctx.paths.has(candidate)) ?? null;
  const plan = planAppRoot({
    existingPath,
    existingSource: existingPath ? await ctx.read(existingPath) : null,
    detectedRoot: ctx.detectedRoot,
  });

  if (plan.violation) ctx.violations.push(plan.violation);
  if (plan.warning) ctx.warnings.push(plan.warning);
  if (plan.content !== null) ctx.add(plan.path, plan.content);
  return plan.path;
}

async function planViteConfig(ctx: {
  paths: Set<string>;
  read: Reader;
  add: Adder;
  violations: string[];
}): Promise<void> {
  const configPath = [...ctx.paths].find((path) => VITE_CONFIG_RE.test(path));
  if (!configPath) {
    ctx.add('vite.config.js', DEFAULT_VITE_CONFIG);
    return;
  }
  const result = transformViteConfig((await ctx.read(configPath)) ?? '');
  if (result.violation) {
    ctx.violations.push(`${configPath}: ${result.violation}`);
    return;
  }
  if (result.changed && result.content) ctx.add(configPath, result.content);
}

async function planPackageJson(ctx: {
  read: Reader;
  add: Adder;
  violations: string[];
}): Promise<void> {
  const result = transformPackageJson(await ctx.read('package.json'));
  if (result.violation) {
    ctx.violations.push(`package.json: ${result.violation}`);
    return;
  }
  if (result.changed && result.content) ctx.add('package.json', result.content);
}

/** Narrows unparsed JSON to a plain object; anything else reads as empty. */
function asJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function planTsconfig(ctx: {
  paths: Set<string>;
  read: Reader;
  add: Adder;
  warnings: string[];
}): Promise<void> {
  if (!ctx.paths.has('tsconfig.json') && !ctx.paths.has('jsconfig.json')) {
    ctx.add('tsconfig.json', DEFAULT_TSCONFIG);
    return;
  }
  const path = ctx.paths.has('tsconfig.json') ? 'tsconfig.json' : 'jsconfig.json';
  const source = (await ctx.read(path)) ?? '';
  if (source.includes('"@/*"')) return;

  try {
    const parsed = asJsonRecord(JSON.parse(source) as unknown);
    const compilerOptions = { ...asJsonRecord(parsed.compilerOptions) };
    compilerOptions.baseUrl ??= '.';
    compilerOptions.paths = { ...asJsonRecord(compilerOptions.paths), '@/*': ['src/*'] };
    ctx.add(path, `${JSON.stringify({ ...parsed, compilerOptions }, null, 2)}\n`);
  } catch {
    // Comments are legal in tsconfig; the Vite alias already resolves `@` at
    // build time, so a stale editor config is not worth failing on.
    ctx.warnings.push(`${path} could not be parsed; the @ alias was left untouched.`);
  }
}
