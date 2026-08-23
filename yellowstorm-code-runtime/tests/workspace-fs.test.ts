import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/runtime/limits.js";
import { WorkspaceFS } from "../src/workspace/workspace-fs.js";
import type { ObjectStore } from "../src/workspace/types.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string; modifiedAt?: string }>();
  readonly listPrefixes: string[] = [];

  async head(key: string) {
    const value = this.objects.get(key);
    return value ? { sizeBytes: value.bytes.byteLength, contentType: value.contentType, ...(value.modifiedAt ? { modifiedAt: value.modifiedAt } : {}) } : null;
  }

  async list(prefix: string, delimiter: string, maxKeys: number, _signal?: AbortSignal, continuationToken?: string) {
    this.listPrefixes.push(prefix);
    const files: Array<{ key: string; sizeBytes: number }> = [];
    const prefixes = new Set<string>();
    for (const [key, value] of this.objects) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (delimiter && slash >= 0) prefixes.add(`${prefix}${rest.slice(0, slash + 1)}`);
      else files.push({ key, sizeBytes: value.bytes.byteLength, ...(value.modifiedAt ? { modifiedAt: value.modifiedAt } : {}) });
    }
    files.sort((a, b) => a.key.localeCompare(b.key));
    const all = [...files, ...[...prefixes].map((key) => ({ key, sizeBytes: 0 }))];
    const offset = Number(continuationToken || 0);
    const page = all.slice(offset, offset + maxKeys);
    return {
      files: page.filter((item) => files.some((file) => file.key === item.key)),
      prefixes: page.filter((item) => prefixes.has(item.key)).map((item) => item.key),
      truncated: offset + maxKeys < all.length,
      ...(offset + maxKeys < all.length ? { nextContinuationToken: String(offset + maxKeys) } : {})
    };
  }

  async read(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error("missing");
    return value.bytes;
  }

  async write(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes: body, contentType });
  }

  async copy(sourceKey: string, destinationKey: string, options: { overwrite: boolean }) {
    if (!options.overwrite && this.objects.has(destinationKey)) throw new Error("exists");
    const source = this.objects.get(sourceKey);
    if (!source) throw new Error("missing");
    this.objects.set(destinationKey, { ...source, bytes: new Uint8Array(source.bytes) });
    return { sizeBytes: source.bytes.byteLength, contentType: source.contentType };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

class DelayedStore extends MemoryStore {
  override async read(key: string) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return super.read(key);
  }

  override async write(key: string, body: Uint8Array, contentType: string) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return super.write(key, body, contentType);
  }
}

class DelayedCopyStore extends MemoryStore {
  override async copy(sourceKey: string, destinationKey: string, options: { overwrite: boolean }) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return super.copy(sourceKey, destinationKey, options);
  }
}

class HeadTrackingStore extends MemoryStore {
  activeHeads = 0;
  maxActiveHeads = 0;

  override async head(key: string) {
    this.activeHeads += 1;
    this.maxActiveHeads = Math.max(this.maxActiveHeads, this.activeHeads);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      return await super.head(key);
    } finally {
      this.activeHeads -= 1;
    }
  }
}

const context = {
  userId: "user-1",
  runId: "run-1",
  mounts: [
    { virtualPath: "/workspace/run", cephPrefix: "user-1/system_run-1", mode: "rw" as const },
    { virtualPath: "/workspace/sources/data", cephPrefix: "owner-2/source-data", mode: "r" as const }
  ]
};

describe("WorkspaceFS", () => {
  it("reads JSON and writes tracked files under the run prefix", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/input.json", {
      bytes: new TextEncoder().encode('{"rows":[1,2]}'), contentType: "application/json"
    });
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);
    await expect(fs.invoke("readJson", ["/workspace/sources/data/input.json"], AbortSignal.timeout(1_000)))
      .resolves.toEqual({ rows: [1, 2] });
    const ref = await fs.invoke("writeJson", ["/workspace/run/output.json", { count: 2 }], AbortSignal.timeout(1_000));
    expect(ref).toEqual({
      name: "output.json", path: "/workspace/run/output.json", sizeBytes: 11,
      contentType: "application/json", createdBy: "run_code"
    });
    expect(ref).not.toHaveProperty("objectKey");
    expect(fs.writtenFiles).toHaveLength(1);
    expect(new TextDecoder().decode(store.objects.get("user-1/system_run-1/output.json")?.bytes)).toBe('{"count":2}');
  });

  it("isolates exact-file mounts from sibling objects", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/allowed/report.txt", { bytes: new TextEncoder().encode("ok"), contentType: "text/plain" });
    store.objects.set("owner-2/source-data/private.txt", { bytes: new TextEncoder().encode("no"), contentType: "text/plain" });
    const scoped = new WorkspaceFS({
      ...context,
      mounts: [context.mounts[0]!, {
        virtualPath: "/workspace/attachments/data", cephPrefix: "owner-2/source-data", mode: "r" as const,
        allowedRelativePaths: ["allowed/report.txt"]
      }]
    }, store, DEFAULT_LIMITS);
    await expect(scoped.invoke("list", ["/workspace/attachments/data"], AbortSignal.timeout(1_000)))
      .resolves.toEqual([{ name: "allowed", path: "/workspace/attachments/data/allowed", type: "directory" }]);
    await expect(scoped.invoke("readText", ["/workspace/attachments/data/allowed/report.txt"], AbortSignal.timeout(1_000)))
      .resolves.toBe("ok");
    await expect(scoped.invoke("readText", ["/workspace/attachments/data/private.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "PATH_NOT_MOUNTED" });
    expect(store.listPrefixes).toEqual([]);
  });

  it("performs bounded glob and deterministic metadata-only find", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/2025/forecast-old.pdf", { bytes: new Uint8Array(3), contentType: "application/pdf", modifiedAt: "2025-01-01T00:00:00.000Z" });
    store.objects.set("owner-2/source-data/2026/forecast-final.pdf", { bytes: new Uint8Array(5), contentType: "application/pdf", modifiedAt: "2026-08-20T10:30:00.000Z" });
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);
    const globbed = await fs.invoke("glob", ["/workspace/sources/data/2026/**/*.pdf"], AbortSignal.timeout(1_000));
    expect(globbed).toEqual([expect.objectContaining({
      name: "forecast-final.pdf", path: "/workspace/sources/data/2026/forecast-final.pdf",
      source: { kind: "workspace", alias: "data" }, sizeBytes: 5
    })]);
    expect(store.listPrefixes).toContain("owner-2/source-data/2026/");
    const found = await fs.invoke("find", ["latest forecast"], AbortSignal.timeout(1_000));
    expect(found).toEqual([expect.objectContaining({ name: "forecast-final.pdf" }), expect.objectContaining({ name: "forecast-old.pdf" })]);
    expect(JSON.stringify(found)).not.toContain("owner-2/source-data");
    const fuzzy = await fs.invoke("find", ["forecast fnal pdf"], AbortSignal.timeout(1_000));
    expect((fuzzy as Array<{ name: string }>)[0]).toEqual(expect.objectContaining({ name: "forecast-final.pdf" }));
  });

  it("fails incomplete scans rather than returning partial results", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/a.txt", { bytes: new Uint8Array(1), contentType: "text/plain" });
    const original = store.list.bind(store);
    store.list = async (...args) => {
      const result = await original(...args);
      const { nextContinuationToken: _unused, ...withoutToken } = result;
      return { ...withoutToken, truncated: true };
    };
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);
    await expect(fs.invoke("find", ["a"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "SCAN_BUDGET_EXCEEDED" });
  });

  it("copies server-side and removes only current-execution artifacts", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/contract.pdf", { bytes: new Uint8Array(50 * 1_048_576), contentType: "application/pdf" });
    store.objects.set("user-1/system_run-1/historical.txt", { bytes: new Uint8Array(1), contentType: "text/plain" });
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);
    const copied = await fs.invoke("copy", [
      "/workspace/sources/data/contract.pdf", "/workspace/run/Supplier Contract 2026.pdf"
    ], AbortSignal.timeout(1_000));
    expect(copied).toMatchObject({ path: "/workspace/run/Supplier Contract 2026.pdf", sizeBytes: 50 * 1_048_576 });
    expect(fs.mutations).toEqual([expect.objectContaining({ operation: "copied" })]);
    await expect(fs.invoke("remove", ["/workspace/run/historical.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "REMOVE_NOT_ALLOWED" });
    await expect(fs.invoke("remove", ["/workspace/run/Supplier Contract 2026.pdf"], AbortSignal.timeout(1_000)))
      .resolves.toEqual({ path: "/workspace/run/Supplier Contract 2026.pdf", removed: true });
    expect(fs.writtenFiles).toEqual([]);
    expect(fs.mutations.at(-1)).toMatchObject({ operation: "removed" });
  });

  it("does not make overwritten historical paths removable and deduplicates outputs", async () => {
    const store = new MemoryStore();
    store.objects.set("user-1/system_run-1/historical.txt", { bytes: new Uint8Array(1), contentType: "text/plain" });
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);

    await fs.invoke("writeText", ["/workspace/run/historical.txt", "first"], AbortSignal.timeout(1_000));
    await fs.invoke("writeText", ["/workspace/run/historical.txt", "second"], AbortSignal.timeout(1_000));

    expect(fs.writtenFiles).toEqual([expect.objectContaining({ path: "/workspace/run/historical.txt", sizeBytes: 6 })]);
    await expect(fs.invoke("remove", ["/workspace/run/historical.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "REMOVE_NOT_ALLOWED" });

    await fs.invoke("writeText", ["/workspace/run/new.txt", "first"], AbortSignal.timeout(1_000));
    await fs.invoke("writeText", ["/workspace/run/new.txt", "second"], AbortSignal.timeout(1_000));
    expect(fs.writtenFiles.filter((file) => file.path.endsWith("/new.txt"))).toHaveLength(1);
    await expect(fs.invoke("remove", ["/workspace/run/new.txt"], AbortSignal.timeout(1_000)))
      .resolves.toMatchObject({ removed: true });
  });

  it("reserves non-overwrite copy destinations across concurrent calls", async () => {
    const store = new DelayedCopyStore();
    store.objects.set("owner-2/source-data/a.txt", { bytes: new Uint8Array(4), contentType: "text/plain" });
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);

    const results = await Promise.allSettled([
      fs.invoke("copy", ["/workspace/sources/data/a.txt", "/workspace/run/a.txt"], AbortSignal.timeout(1_000)),
      fs.invoke("copy", ["/workspace/sources/data/a.txt", "/workspace/run/a.txt"], AbortSignal.timeout(1_000)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "DESTINATION_EXISTS" } });
    expect(fs.writtenFiles).toHaveLength(1);
  });

  it("bounds exact-file listing and metadata concurrency", async () => {
    const store = new HeadTrackingStore();
    const allowedRelativePaths = ["a.txt", "b.txt", "c.txt", "d.txt"];
    for (const path of allowedRelativePaths) {
      store.objects.set(`owner-2/source-data/${path}`, { bytes: new Uint8Array(1), contentType: "text/plain" });
    }
    const scopedContext = {
      ...context,
      mounts: [context.mounts[0]!, {
        virtualPath: "/workspace/attachments/data",
        cephPrefix: "owner-2/source-data",
        mode: "r" as const,
        allowedRelativePaths,
      }],
    };
    const listFs = new WorkspaceFS(scopedContext, store, { ...DEFAULT_LIMITS, maxListEntries: 2 });
    await expect(listFs.invoke("list", ["/workspace/attachments/data"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "LIST_TOO_LARGE" });
    expect(store.maxActiveHeads).toBe(0);

    const scanFs = new WorkspaceFS(scopedContext, store, { ...DEFAULT_LIMITS, maxConcurrentFsOperations: 2 });
    await expect(scanFs.invoke("find", ["txt"], AbortSignal.timeout(1_000))).resolves.toHaveLength(4);
    expect(store.maxActiveHeads).toBeLessThanOrEqual(2);
  });

  it("enforces glob, scan, copy, and overwrite budgets independently", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/a.txt", { bytes: new Uint8Array(4), contentType: "text/plain" });
    store.objects.set("owner-2/source-data/b.txt", { bytes: new Uint8Array(4), contentType: "text/plain" });
    store.objects.set("user-1/system_run-1/existing.txt", { bytes: new Uint8Array(1), contentType: "text/plain" });
    const fs = new WorkspaceFS(context, store, {
      ...DEFAULT_LIMITS,
      maxGlobResults: 1,
      maxCopyOperations: 1,
      maxTotalCopiedBytes: 6,
    });
    await expect(fs.invoke("glob", ["/workspace/sources/data/*.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "GLOB_RESULT_LIMIT" });
    await expect(fs.invoke("copy", ["/workspace/sources/data/a.txt", "/workspace/run/existing.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    await expect(fs.invoke("copy", ["/workspace/sources/data/a.txt", "/workspace/run/a.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "COPY_LIMIT" });

    const scanFs = new WorkspaceFS(context, store, { ...DEFAULT_LIMITS, maxScannedKeys: 1 });
    await expect(scanFs.invoke("find", ["txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "SCAN_BUDGET_EXCEEDED" });
  });

  it("lists direct children deterministically and detects virtual directories", async () => {
    const store = new MemoryStore();
    for (const key of ["owner-2/source-data/z.txt", "owner-2/source-data/a.txt", "owner-2/source-data/sub/nested.txt"]) {
      store.objects.set(key, { bytes: new Uint8Array([1]), contentType: "text/plain" });
    }
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);
    const entries = await fs.invoke("list", ["/workspace/sources/data"], AbortSignal.timeout(1_000));
    expect(entries).toEqual([
      { name: "a.txt", path: "/workspace/sources/data/a.txt", type: "file", sizeBytes: 1 },
      { name: "sub", path: "/workspace/sources/data/sub", type: "directory" },
      { name: "z.txt", path: "/workspace/sources/data/z.txt", type: "file", sizeBytes: 1 }
    ]);
    await expect(fs.invoke("stat", ["/workspace/sources/data/sub"], AbortSignal.timeout(1_000)))
      .resolves.toEqual({ path: "/workspace/sources/data/sub", type: "directory" });
  });

  it("blocks source writes and enforces operation quotas", async () => {
    const store = new MemoryStore();
    const fs = new WorkspaceFS(context, store, { ...DEFAULT_LIMITS, maxFsOperations: 1 });
    await expect(fs.invoke("writeText", ["/workspace/sources/data/no.txt", "no"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "READ_ONLY_MOUNT" });
    await expect(fs.invoke("list", ["/workspace"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "HOST_OPERATION_LIMIT" });
  });

  it("rejects invalid UTF-8", async () => {
    const store = new MemoryStore();
    store.objects.set("owner-2/source-data/bad.txt", { bytes: new Uint8Array([0xff]), contentType: "text/plain" });
    const fs = new WorkspaceFS(context, store, DEFAULT_LIMITS);
    await expect(fs.invoke("readText", ["/workspace/sources/data/bad.txt"], AbortSignal.timeout(1_000)))
      .rejects.toMatchObject({ code: "INVALID_UTF8" });
  });

  it("atomically reserves aggregate quotas across concurrent operations", async () => {
    const store = new DelayedStore();
    store.objects.set("owner-2/source-data/a.txt", { bytes: new Uint8Array(4), contentType: "text/plain" });
    store.objects.set("owner-2/source-data/b.txt", { bytes: new Uint8Array(4), contentType: "text/plain" });
    const limits = {
      ...DEFAULT_LIMITS,
      maxTotalReadBytes: 6,
      maxTotalWriteBytes: 6,
    };
    const readFs = new WorkspaceFS(context, store, limits);
    const reads = await Promise.allSettled([
      readFs.invoke("readText", ["/workspace/sources/data/a.txt"], AbortSignal.timeout(1_000)),
      readFs.invoke("readText", ["/workspace/sources/data/b.txt"], AbortSignal.timeout(1_000)),
    ]);
    expect(reads.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(reads.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "TOTAL_READ_LIMIT" },
    });

    const writeFs = new WorkspaceFS(context, store, limits);
    const writes = await Promise.allSettled([
      writeFs.invoke("writeText", ["/workspace/run/a.txt", "1234"], AbortSignal.timeout(1_000)),
      writeFs.invoke("writeText", ["/workspace/run/b.txt", "5678"], AbortSignal.timeout(1_000)),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "TOTAL_WRITE_LIMIT" },
    });
  });
});
