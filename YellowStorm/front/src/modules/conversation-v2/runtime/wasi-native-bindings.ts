/**
 * NodePod has no native N-API binaries. Vite 7 (Rolldown), LightningCSS, and
 * Tailwind Oxide fall back to wasm32-wasi packages — but NodePod's FS proxy
 * looks for `*.debug.wasm` on jsDelivr, while npm only ships the release
 * `*.wasm`. Without a local alias the CDN 404s and the preview stays white
 * even though the HTTP probe reports "ready".
 */

export const ROLLDOWN_PKG = '/node_modules/rolldown';
export const ROLLDOWN_WASM_PKG = '/node_modules/@rolldown/binding-wasm32-wasi';
export const LIGHTNINGCSS_PKG = '/node_modules/lightningcss';
export const LIGHTNINGCSS_WASM_PKG = '/node_modules/lightningcss-wasm';
export const OXIDE_PKG = '/node_modules/@tailwindcss/oxide';
export const OXIDE_WASM_PKG = '/node_modules/@tailwindcss/oxide-wasm32-wasi';
export const TAILWIND_PKG = '/node_modules/tailwindcss';

export interface WasiFs {
  exists(path: string): Promise<boolean>;
  readFile(path: string, encoding?: 'utf-8'): Promise<string | Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
}

export interface WasiPod {
  fs: WasiFs;
  spawn(
    cmd: string,
    args: string[],
  ): Promise<{
    on(event: 'output' | 'error', cb: (text: string) => void): void;
    completion: Promise<{ exitCode: number; stdout: string; stderr?: string }>;
  }>;
}

export interface WasiBindingSpec {
  /** Native package that triggers the wasm fallback. */
  nativePath: string;
  /** Optional alternate native path (e.g. oxide via tailwindcss). */
  alternateNativePath?: string;
  wasmPackagePath: string;
  npmSpec: (version: string) => string;
  versionFromPath: string;
  releaseWasmFile: string;
  debugWasmFile: string;
}

export const WASI_BINDING_SPECS: readonly WasiBindingSpec[] = [
  {
    nativePath: ROLLDOWN_PKG,
    wasmPackagePath: ROLLDOWN_WASM_PKG,
    npmSpec: (v) => `@rolldown/binding-wasm32-wasi@${v}`,
    versionFromPath: `${ROLLDOWN_PKG}/package.json`,
    releaseWasmFile: 'rolldown-binding.wasm32-wasi.wasm',
    debugWasmFile: 'rolldown-binding.wasm32-wasi.debug.wasm',
  },
  {
    nativePath: LIGHTNINGCSS_PKG,
    wasmPackagePath: LIGHTNINGCSS_WASM_PKG,
    npmSpec: (v) => `lightningcss-wasm@${v}`,
    versionFromPath: `${LIGHTNINGCSS_PKG}/package.json`,
    // lightningcss-wasm ships a single file; NodePod maps it under /lightningcss-wasm/.
    releaseWasmFile: 'lightningcss_node.wasm',
    debugWasmFile: 'lightningcss_node.wasm',
  },
  {
    nativePath: OXIDE_PKG,
    alternateNativePath: TAILWIND_PKG,
    wasmPackagePath: OXIDE_WASM_PKG,
    npmSpec: (v) => `@tailwindcss/oxide-wasm32-wasi@${v}`,
    versionFromPath: `${OXIDE_PKG}/package.json`,
    releaseWasmFile: 'tailwindcss-oxide.wasm32-wasi.wasm',
    debugWasmFile: 'tailwindcss-oxide.wasm32-wasi.debug.wasm',
  },
] as const;

const NESTED_OXIDE_PKG_JSON =
  '/node_modules/tailwindcss/node_modules/@tailwindcss/oxide/package.json';

async function resolveBindingVersion(
  fs: WasiFs,
  spec: WasiBindingSpec,
): Promise<string> {
  const primary = await readPackageVersion(fs, spec.versionFromPath);
  if (primary) return primary;
  if (spec.wasmPackagePath === OXIDE_WASM_PKG) {
    const nested = await readPackageVersion(fs, NESTED_OXIDE_PKG_JSON);
    if (nested) return nested;
  }
  if (spec.alternateNativePath) {
    const alt = await readPackageVersion(fs, `${spec.alternateNativePath}/package.json`);
    if (alt) return alt;
  }
  return 'latest';
}

/** stderr / proxy noise that means the CSS/bundler toolchain cannot run. */
export function isFatalWasiToolchainError(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('404') && lower.includes('.debug.wasm')) return true;
  if (lower.includes('wasm-fallback') && lower.includes('enoent')) return true;
  if (
    lower.includes('lightningcss-wasm') &&
    (lower.includes('enoent') || lower.includes('no such file'))
  ) {
    return true;
  }
  return false;
}

export async function readPackageVersion(
  fs: WasiFs,
  pkgJsonPath: string,
): Promise<string | null> {
  try {
    const raw = await fs.readFile(pkgJsonPath, 'utf-8');
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const pkg = JSON.parse(text) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * NodePod's FS proxy requests `*.debug.wasm` from the CDN. npm packages only
 * ship the release `*.wasm` — copy locally so the proxy never hits jsDelivr.
 */
export async function ensureDebugWasmAlias(
  fs: WasiFs,
  packageDir: string,
  releaseFile: string,
  debugFile: string,
): Promise<boolean> {
  if (releaseFile === debugFile) {
    return fs.exists(`${packageDir}/${releaseFile}`);
  }
  const releasePath = `${packageDir}/${releaseFile}`;
  const debugPath = `${packageDir}/${debugFile}`;
  if (await fs.exists(debugPath)) return true;
  if (!(await fs.exists(releasePath))) return false;
  const bytes = await fs.readFile(releasePath);
  await fs.writeFile(debugPath, bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes));
  return true;
}

async function nativePresent(fs: WasiFs, spec: WasiBindingSpec): Promise<boolean> {
  if (await fs.exists(spec.nativePath)) return true;
  if (spec.alternateNativePath && (await fs.exists(spec.alternateNativePath))) {
    // Tailwind v4 pulls oxide transitively; only act when oxide itself is there
    // or when package.json of alternate says major >= 4.
    if (await fs.exists(spec.nativePath)) return true;
    const ver = await readPackageVersion(fs, `${spec.alternateNativePath}/package.json`);
    if (ver && Number.parseInt(ver.split('.')[0] ?? '0', 10) >= 4) return true;
  }
  return false;
}

async function installWasmPackage(
  pod: WasiPod,
  spec: string,
  log: (msg: string, details?: Record<string, unknown>) => void,
): Promise<boolean> {
  log('wasi-wasm:install', { spec });
  const install = await pod.spawn('npm', ['install', spec, '--no-save', '--cpu=wasm32']);
  install.on('output', (text) => log('wasi-wasm:stdout', { text: text.slice(0, 200) }));
  install.on('error', (text) => log('wasi-wasm:stderr', { text: text.slice(0, 200) }));
  const result = await install.completion;
  return result.exitCode === 0;
}

/**
 * Install wasm32-wasi companions for native tooling and alias debug.wasm files.
 * Returns true when at least one binding was prepared (so Vite should force WASI).
 */
export async function ensureWasiNativeBindings(
  pod: WasiPod,
  log: (phase: string, details?: Record<string, unknown>) => void = () => undefined,
): Promise<{ prepared: string[]; failed: string[] }> {
  const prepared: string[] = [];
  const failed: string[] = [];

  for (const spec of WASI_BINDING_SPECS) {
    if (!(await nativePresent(pod.fs, spec))) continue;

    let present = await pod.fs.exists(spec.wasmPackagePath);
    if (!present) {
      const version = await resolveBindingVersion(pod.fs, spec);
      const ok = await installWasmPackage(pod, spec.npmSpec(version), log);
      present = ok && (await pod.fs.exists(spec.wasmPackagePath));
      if (!present) {
        failed.push(spec.wasmPackagePath);
        log('wasi-wasm:install-failed', { path: spec.wasmPackagePath, version });
        continue;
      }
    }

    const aliased = await ensureDebugWasmAlias(
      pod.fs,
      spec.wasmPackagePath,
      spec.releaseWasmFile,
      spec.debugWasmFile,
    );
    if (!aliased && spec.releaseWasmFile !== spec.debugWasmFile) {
      failed.push(`${spec.wasmPackagePath}/${spec.debugWasmFile}`);
      log('wasi-wasm:alias-failed', {
        dir: spec.wasmPackagePath,
        release: spec.releaseWasmFile,
        debug: spec.debugWasmFile,
      });
      continue;
    }

    prepared.push(spec.wasmPackagePath);
  }

  return { prepared, failed };
}
