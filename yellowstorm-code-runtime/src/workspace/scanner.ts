import { RuntimeError } from "../runtime/errors.js";
import type { RuntimeLimits } from "../runtime/limits.js";
import { resolvedFile } from "./public-file.js";
import type { ObjectStore, ResolvedFile, WorkspaceMount } from "./types.js";

export interface ScanAccounting {
  pages: number;
  keys: number;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    results.push(...await Promise.all(values.slice(index, index + concurrency).map(mapper)));
  }
  return results;
}

export class WorkspaceScanner {
  constructor(
    private readonly store: ObjectStore,
    private readonly limits: RuntimeLimits,
    private readonly total: ScanAccounting
  ) {}

  async scan(
    mount: WorkspaceMount,
    relativePrefix: string,
    signal: AbortSignal
  ): Promise<ResolvedFile[]> {
    const allowed = mount.allowedRelativePaths;
    if (allowed !== undefined) {
      const candidates = allowed.filter((path) => !relativePrefix || path === relativePrefix || path.startsWith(`${relativePrefix}/`));
      this.reserveKeys(candidates.length, candidates.length);
      const files = await mapWithConcurrency(candidates, this.limits.maxConcurrentFsOperations, async (relative) => {
        const metadata = await this.store.head(`${mount.cephPrefix}/${relative}`, signal);
        return metadata ? resolvedFile(mount, `${mount.virtualPath}/${relative}`, metadata) : null;
      });
      return files.filter((file): file is ResolvedFile => file !== null).sort((a, b) => a.path.localeCompare(b.path));
    }

    const storagePrefix = [mount.cephPrefix, relativePrefix].filter(Boolean).join("/").replace(/\/+$/g, "") + "/";
    const virtualPrefix = [mount.virtualPath, relativePrefix].filter(Boolean).join("/").replace(/\/+$/g, "");
    const files: ResolvedFile[] = [];
    let token: string | undefined;
    let pages = 0;
    let keys = 0;
    do {
      this.reservePage(pages);
      const page = await this.store.list(storagePrefix, "", 1_000, signal, token);
      pages += 1;
      keys += page.files.length;
      this.reserveKeys(page.files.length, keys);
      for (const file of page.files) {
        const relative = file.key.slice(storagePrefix.length);
        if (!relative) continue;
        files.push(resolvedFile(mount, `${virtualPrefix}/${relative}`, file));
      }
      if (!page.truncated) break;
      if (!page.nextContinuationToken) {
        throw new RuntimeError("SCAN_BUDGET_EXCEEDED", "Workspace scan could not establish completeness.");
      }
      token = page.nextContinuationToken;
    } while (true);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private reservePage(operationPages: number): void {
    if (operationPages >= this.limits.maxScanPages || this.total.pages >= this.limits.maxTotalScanPages) {
      throw new RuntimeError("SCAN_BUDGET_EXCEEDED", "Workspace scan page budget exceeded.");
    }
    this.total.pages += 1;
  }

  private reserveKeys(count: number, operationKeys: number): void {
    if (operationKeys > this.limits.maxScannedKeys || this.total.keys + count > this.limits.maxTotalScannedKeys) {
      throw new RuntimeError("SCAN_BUDGET_EXCEEDED", "Workspace scan key budget exceeded.");
    }
    this.total.keys += count;
  }
}
