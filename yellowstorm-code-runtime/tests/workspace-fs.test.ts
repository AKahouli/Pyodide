import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/runtime/limits.js";
import { WorkspaceFS } from "../src/workspace/workspace-fs.js";
import type { ObjectStore } from "../src/workspace/types.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async head(key: string) {
    const value = this.objects.get(key);
    return value ? { sizeBytes: value.bytes.byteLength, contentType: value.contentType } : null;
  }

  async list(prefix: string, _delimiter: string, maxKeys: number) {
    const files: Array<{ key: string; sizeBytes: number }> = [];
    const prefixes = new Set<string>();
    for (const [key, value] of this.objects) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) prefixes.add(`${prefix}${rest.slice(0, slash + 1)}`);
      else files.push({ key, sizeBytes: value.bytes.byteLength });
    }
    const all = [...files, ...[...prefixes].map((key) => ({ key, sizeBytes: 0 }))];
    return {
      files: files.slice(0, maxKeys),
      prefixes: [...prefixes].slice(0, Math.max(0, maxKeys - files.length)),
      truncated: all.length > maxKeys
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
    expect(ref).toMatchObject({ objectKey: "user-1/system_run-1/output.json", contentType: "application/json" });
    expect(fs.writtenFiles).toHaveLength(1);
    expect(new TextDecoder().decode(store.objects.get("user-1/system_run-1/output.json")?.bytes)).toBe('{"count":2}');
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
