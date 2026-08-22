import { TextDecoder } from "node:util";
import { RuntimeError, asRuntimeError } from "../runtime/errors.js";
import type { RuntimeLimits } from "../runtime/limits.js";
import { resolvePath, validateMounts } from "./path-resolver.js";
import type {
  ExecutionContext,
  FileRef,
  ObjectStore,
  WorkspaceEntry,
  WorkspaceHost,
  WorkspaceMount
} from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export class WorkspaceFS implements WorkspaceHost {
  readonly writtenFiles: FileRef[] = [];
  private readonly mounts: WorkspaceMount[];
  private operations = 0;
  private activeOperations = 0;
  private totalReadBytes = 0;
  private totalWriteBytes = 0;

  constructor(
    context: ExecutionContext,
    private readonly store: ObjectStore,
    private readonly limits: RuntimeLimits
  ) {
    this.mounts = validateMounts(context, limits.maxMounts);
  }

  async invoke(operation: string, args: unknown[], signal: AbortSignal): Promise<unknown> {
    this.operations += 1;
    if (this.operations > this.limits.maxFsOperations) {
      throw new RuntimeError("HOST_OPERATION_LIMIT", "Filesystem operation limit exceeded.");
    }
    if (this.activeOperations >= this.limits.maxConcurrentFsOperations) {
      throw new RuntimeError("HOST_CONCURRENCY_LIMIT", "Too many concurrent filesystem operations.");
    }
    this.activeOperations += 1;
    try {
      switch (operation) {
        case "list": return await this.list(this.pathArg(args), signal);
        case "stat": return await this.stat(this.pathArg(args), signal);
        case "readText": return await this.readText(this.pathArg(args), signal);
        case "readJson": return JSON.parse(await this.readText(this.pathArg(args), signal));
        case "writeText": return await this.writeText(this.pathArg(args), args[1], signal);
        case "writeJson": return await this.writeJson(this.pathArg(args), args[1], signal);
        default: throw new RuntimeError("INVALID_REQUEST", "Unknown filesystem operation.");
      }
    } catch (error) {
      if (error instanceof SyntaxError && operation === "readJson") {
        throw new RuntimeError("INVALID_JSON", "Workspace file is not valid JSON.");
      }
      throw asRuntimeError(error);
    } finally {
      this.activeOperations -= 1;
    }
  }

  private pathArg(args: unknown[]): string {
    if (typeof args[0] !== "string") throw new RuntimeError("INVALID_PATH", "A workspace path is required.");
    return args[0];
  }

  private async list(path: string, signal: AbortSignal): Promise<WorkspaceEntry[]> {
    const normalized = path.replace(/\/+$/g, "") || "/";
    if (normalized === "/workspace") {
      return this.mounts
        .map((mount) => ({ name: mount.virtualPath.split("/").at(-1) ?? "", path: mount.virtualPath, type: "directory" as const }))
        .sort((a, b) => a.path.localeCompare(b.path));
    }
    const resolved = resolvePath(this.mounts, path);
    const prefix = `${resolved.objectKey.replace(/\/+$/g, "")}/`;
    const listed = await this.store.list(prefix, "/", this.limits.maxListEntries + 1, signal);
    const entries: WorkspaceEntry[] = [
      ...listed.prefixes.map((key) => {
        const relative = key.slice(prefix.length).replace(/\/$/, "");
        return { name: relative, path: `${resolved.virtualPath}/${relative}`, type: "directory" as const };
      }),
      ...listed.files.map((file) => {
        const relative = file.key.slice(prefix.length);
        return { name: relative, path: `${resolved.virtualPath}/${relative}`, type: "file" as const, sizeBytes: file.sizeBytes };
      })
    ].filter((entry) => entry.name && !entry.name.includes("/"));
    if (listed.truncated || entries.length > this.limits.maxListEntries) {
      throw new RuntimeError("LIST_TOO_LARGE", "Directory contains too many entries.");
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async stat(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const resolved = resolvePath(this.mounts, path);
    if (!resolved.relativePath) return { path: resolved.virtualPath, type: "directory" };
    const exact = await this.store.head(resolved.objectKey, signal);
    if (exact) return { path: resolved.virtualPath, type: "file", ...exact };
    const probe = await this.store.list(`${resolved.objectKey}/`, "/", 1, signal);
    if (probe.files.length || probe.prefixes.length) return { path: resolved.virtualPath, type: "directory" };
    throw new RuntimeError("FILE_NOT_FOUND", "Workspace path was not found.", 404);
  }

  private async readText(path: string, signal: AbortSignal): Promise<string> {
    const resolved = resolvePath(this.mounts, path);
    if (!resolved.relativePath) throw new RuntimeError("INVALID_PATH", "Cannot read a mount root as a file.");
    const head = await this.store.head(resolved.objectKey, signal);
    if (!head) throw new RuntimeError("FILE_NOT_FOUND", "Workspace file was not found.", 404);
    if (head.sizeBytes > this.limits.maxReadFileBytes) throw new RuntimeError("FILE_TOO_LARGE", "Workspace file is too large.");
    this.reserveReadBytes(head.sizeBytes);
    let bytes: Uint8Array;
    try {
      bytes = await this.store.read(resolved.objectKey, this.limits.maxReadFileBytes, signal);
      if (bytes.byteLength > head.sizeBytes) {
        this.reserveReadBytes(bytes.byteLength - head.sizeBytes);
      } else {
        this.totalReadBytes -= head.sizeBytes - bytes.byteLength;
      }
    } catch (error) {
      this.totalReadBytes -= head.sizeBytes;
      throw error;
    }
    try {
      return decoder.decode(bytes);
    } catch {
      throw new RuntimeError("INVALID_UTF8", "Workspace file is not valid UTF-8.");
    }
  }

  private async writeText(path: string, value: unknown, signal: AbortSignal): Promise<FileRef> {
    if (typeof value !== "string") throw new RuntimeError("INVALID_REQUEST", "writeText content must be a string.");
    return this.write(path, encoder.encode(value), "text/plain; charset=utf-8", signal);
  }

  private async writeJson(path: string, value: unknown, signal: AbortSignal): Promise<FileRef> {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new RuntimeError("INVALID_OUTPUT", "writeJson value must be JSON-compatible.");
    }
    if (serialized === undefined) throw new RuntimeError("INVALID_OUTPUT", "writeJson value must be JSON-compatible.");
    return this.write(path, encoder.encode(serialized), "application/json", signal);
  }

  private async write(path: string, bytes: Uint8Array, contentType: string, signal: AbortSignal): Promise<FileRef> {
    const resolved = resolvePath(this.mounts, path);
    if (resolved.mount.mode !== "rw") throw new RuntimeError("READ_ONLY_MOUNT", "Source workspaces are read-only.", 403);
    if (!resolved.relativePath || resolved.virtualPath.endsWith("/")) throw new RuntimeError("INVALID_PATH", "A file path is required for writes.");
    if (bytes.byteLength > this.limits.maxWriteFileBytes) throw new RuntimeError("WRITE_TOO_LARGE", "Workspace write is too large.");
    this.reserveWriteBytes(bytes.byteLength);
    try {
      await this.store.write(resolved.objectKey, bytes, contentType, signal);
    } catch (error) {
      this.totalWriteBytes -= bytes.byteLength;
      throw error;
    }
    const ref: FileRef = {
      name: resolved.relativePath.split("/").at(-1) ?? resolved.relativePath,
      virtualPath: resolved.virtualPath,
      objectKey: resolved.objectKey,
      sizeBytes: bytes.byteLength,
      contentType,
      createdBy: "run_code"
    };
    this.writtenFiles.push(ref);
    return ref;
  }

  private reserveReadBytes(bytes: number): void {
    if (this.totalReadBytes + bytes > this.limits.maxTotalReadBytes) {
      throw new RuntimeError("TOTAL_READ_LIMIT", "Total read limit exceeded.");
    }
    this.totalReadBytes += bytes;
  }

  private reserveWriteBytes(bytes: number): void {
    if (this.totalWriteBytes + bytes > this.limits.maxTotalWriteBytes) {
      throw new RuntimeError("TOTAL_WRITE_LIMIT", "Total write limit exceeded.");
    }
    this.totalWriteBytes += bytes;
  }
}
