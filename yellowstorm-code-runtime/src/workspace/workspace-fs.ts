import { TextDecoder } from "node:util";
import { RuntimeError, asRuntimeError } from "../runtime/errors.js";
import type { RuntimeLimits } from "../runtime/limits.js";
import { resolvePath, validateMounts } from "./path-resolver.js";
import { globMatcher, rankFiles, staticGlobRoot } from "./matcher.js";
import { publicFile } from "./public-file.js";
import { WorkspaceScanner } from "./scanner.js";
import type {
  ExecutionContext,
  InternalFileRef,
  ObjectStore,
  PublicFileRef,
  ResolvedFile,
  WorkspaceEntry,
  WorkspaceHost,
  WorkspaceMount,
  WorkspaceMutation
} from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export class WorkspaceFS implements WorkspaceHost {
  readonly writtenFiles: PublicFileRef[] = [];
  readonly mutations: WorkspaceMutation[] = [];
  private readonly mounts: WorkspaceMount[];
  private readonly currentExecutionArtifacts = new Set<string>();
  private readonly reservedCopyDestinations = new Set<string>();
  private readonly scanAccounting = { pages: 0, keys: 0 };
  private operations = 0;
  private activeOperations = 0;
  private totalReadBytes = 0;
  private totalWriteBytes = 0;
  private copyOperations = 0;
  private totalCopiedBytes = 0;

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
        case "glob": return await this.glob(this.pathArg(args), signal);
        case "find": return await this.find(this.pathArg(args), signal);
        case "stat": return await this.stat(this.pathArg(args), signal);
        case "readText": return await this.readText(this.pathArg(args), signal);
        case "readJson": return JSON.parse(await this.readText(this.pathArg(args), signal));
        case "writeText": return await this.writeText(this.pathArg(args), args[1], signal);
        case "writeJson": return await this.writeJson(this.pathArg(args), args[1], signal);
        case "copy": return await this.copy(this.pathArg(args), args[1], args[2], signal);
        case "remove": return await this.remove(this.pathArg(args), signal);
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
    if (resolved.mount.allowedRelativePaths !== undefined) {
      const prefix = resolved.relativePath ? `${resolved.relativePath}/` : "";
      const entries = new Map<string, WorkspaceEntry>();
      const directFiles = new Map<string, string>();
      for (const allowed of resolved.mount.allowedRelativePaths) {
        if (!allowed.startsWith(prefix) || allowed === resolved.relativePath) continue;
        const remainder = allowed.slice(prefix.length);
        const [name, ...rest] = remainder.split("/");
        if (!name) continue;
        const entryPath = `${resolved.virtualPath}/${name}`;
        if (rest.length) {
          entries.set(name, { name, path: entryPath, type: "directory" });
        } else {
          directFiles.set(name, allowed);
        }
      }
      if (entries.size + directFiles.size > this.limits.maxListEntries) {
        throw new RuntimeError("LIST_TOO_LARGE", "Directory contains too many entries.");
      }
      for (const [name, allowed] of directFiles) {
        const metadata = await this.store.head(`${resolved.mount.cephPrefix}/${allowed}`, signal);
        if (metadata) entries.set(name, { name, path: `${resolved.virtualPath}/${name}`, type: "file", sizeBytes: metadata.sizeBytes, ...(metadata.contentType ? { contentType: metadata.contentType } : {}) });
      }
      return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
    }
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

  private async glob(pattern: string, signal: AbortSignal): Promise<ResolvedFile[]> {
    if (!pattern.startsWith("/workspace/")) throw new RuntimeError("INVALID_PATH", "Glob patterns must use absolute workspace paths.");
    const root = staticGlobRoot(pattern).replace(/\/+$/g, "") || "/workspace";
    const match = globMatcher(pattern);
    const scanner = new WorkspaceScanner(this.store, this.limits, this.scanAccounting);
    let files: ResolvedFile[] = [];
    if (root === "/workspace") {
      for (const mount of this.mounts) files.push(...await scanner.scan(mount, "", signal));
    } else {
      const resolved = resolvePath(this.mounts, root);
      files = await scanner.scan(resolved.mount, resolved.relativePath, signal);
    }
    const matches = files.filter((file) => match(file.path));
    if (matches.length > this.limits.maxGlobResults) {
      throw new RuntimeError("GLOB_RESULT_LIMIT", "Glob result limit exceeded.");
    }
    return matches;
  }

  private async find(query: string, signal: AbortSignal): Promise<ResolvedFile[]> {
    if (!query.trim()) throw new RuntimeError("INVALID_REQUEST", "A file search query is required.");
    const scanner = new WorkspaceScanner(this.store, this.limits, this.scanAccounting);
    const files: ResolvedFile[] = [];
    for (const mount of this.mounts) files.push(...await scanner.scan(mount, "", signal));
    return rankFiles(files, query).slice(0, this.limits.maxFindResults);
  }

  private async stat(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const resolved = resolvePath(this.mounts, path);
    if (!resolved.relativePath) return { path: resolved.virtualPath, type: "directory" };
    if (resolved.mount.allowedRelativePaths !== undefined && !resolved.mount.allowedRelativePaths.includes(resolved.relativePath)) {
      return { path: resolved.virtualPath, type: "directory" };
    }
    const exact = await this.store.head(resolved.objectKey, signal);
    if (exact) return { path: resolved.virtualPath, type: "file", ...exact };
    const probe = await this.store.list(`${resolved.objectKey}/`, "/", 1, signal);
    if (probe.files.length || probe.prefixes.length) return { path: resolved.virtualPath, type: "directory" };
    throw new RuntimeError("FILE_NOT_FOUND", "Workspace path was not found.", 404);
  }

  private async readText(path: string, signal: AbortSignal): Promise<string> {
    const resolved = resolvePath(this.mounts, path);
    if (!resolved.relativePath) throw new RuntimeError("INVALID_PATH", "Cannot read a mount root as a file.");
    if (resolved.mount.allowedRelativePaths !== undefined && !resolved.mount.allowedRelativePaths.includes(resolved.relativePath)) {
      throw new RuntimeError("PATH_NOT_MOUNTED", "Path is outside the authorized file scope.");
    }
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

  private async writeText(path: string, value: unknown, signal: AbortSignal): Promise<PublicFileRef> {
    if (typeof value !== "string") throw new RuntimeError("INVALID_REQUEST", "writeText content must be a string.");
    return this.write(path, encoder.encode(value), "text/plain; charset=utf-8", signal);
  }

  private async writeJson(path: string, value: unknown, signal: AbortSignal): Promise<PublicFileRef> {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new RuntimeError("INVALID_OUTPUT", "writeJson value must be JSON-compatible.");
    }
    if (serialized === undefined) throw new RuntimeError("INVALID_OUTPUT", "writeJson value must be JSON-compatible.");
    return this.write(path, encoder.encode(serialized), "application/json", signal);
  }

  private async write(path: string, bytes: Uint8Array, contentType: string, signal: AbortSignal): Promise<PublicFileRef> {
    const resolved = resolvePath(this.mounts, path);
    if (resolved.mount.mode !== "rw") throw new RuntimeError("READ_ONLY_MOUNT", "Source workspaces are read-only.", 403);
    if (!resolved.relativePath || resolved.virtualPath.endsWith("/")) throw new RuntimeError("INVALID_PATH", "A file path is required for writes.");
    if (bytes.byteLength > this.limits.maxWriteFileBytes) throw new RuntimeError("WRITE_TOO_LARGE", "Workspace write is too large.");
    const alreadyOwned = this.currentExecutionArtifacts.has(resolved.virtualPath);
    const existedBeforeWrite = alreadyOwned ? false : await this.store.head(resolved.objectKey, signal) !== null;
    this.reserveWriteBytes(bytes.byteLength);
    try {
      await this.store.write(resolved.objectKey, bytes, contentType, signal);
    } catch (error) {
      this.totalWriteBytes -= bytes.byteLength;
      throw error;
    }
    const internal: InternalFileRef = {
      name: resolved.relativePath.split("/").at(-1) ?? resolved.relativePath,
      path: resolved.virtualPath,
      objectKey: resolved.objectKey,
      sizeBytes: bytes.byteLength,
      contentType,
      createdBy: "run_code"
    };
    const ref = publicFile(internal);
    if (!existedBeforeWrite) this.currentExecutionArtifacts.add(resolved.virtualPath);
    this.recordWrittenFile(ref);
    this.mutations.push({ operation: "created", path: ref.path, sizeBytes: ref.sizeBytes, ...(ref.contentType ? { contentType: ref.contentType } : {}) });
    return ref;
  }

  private async copy(sourcePath: string, destinationValue: unknown, optionsValue: unknown, signal: AbortSignal): Promise<PublicFileRef> {
    if (typeof destinationValue !== "string") throw new RuntimeError("INVALID_PATH", "A copy destination path is required.");
    const options = optionsValue && typeof optionsValue === "object" && !Array.isArray(optionsValue)
      ? optionsValue as Record<string, unknown>
      : {};
    if (options.overwrite !== undefined && typeof options.overwrite !== "boolean") {
      throw new RuntimeError("INVALID_REQUEST", "copy overwrite must be a boolean.");
    }
    this.copyOperations += 1;
    if (this.copyOperations > this.limits.maxCopyOperations) throw new RuntimeError("COPY_LIMIT", "Copy operation limit exceeded.");
    const source = resolvePath(this.mounts, sourcePath);
    if (!source.relativePath || (source.mount.allowedRelativePaths !== undefined && !source.mount.allowedRelativePaths.includes(source.relativePath))) {
      throw new RuntimeError("PATH_NOT_MOUNTED", "Copy source is outside the authorized file scope.");
    }
    const destination = resolvePath(this.mounts, destinationValue);
    if (destination.mount.mode !== "rw" || !destination.relativePath) {
      throw new RuntimeError("READ_ONLY_MOUNT", "Copies must be written under /workspace/run.", 403);
    }
    const metadata = await this.store.head(source.objectKey, signal);
    if (!metadata) throw new RuntimeError("FILE_NOT_FOUND", "Workspace file was not found.", 404);
    if (metadata.sizeBytes > this.limits.maxCopyFileBytes) throw new RuntimeError("COPY_FILE_TOO_LARGE", "Workspace file exceeds the copy limit.");
    const overwrite = options.overwrite === true;
    if (this.reservedCopyDestinations.has(destination.virtualPath)) {
      throw new RuntimeError("DESTINATION_EXISTS", "Destination file already exists.", 409);
    }
    this.reservedCopyDestinations.add(destination.virtualPath);
    let copyBytesReserved = false;
    try {
      const destinationWasOwned = this.currentExecutionArtifacts.has(destination.virtualPath);
      const destinationExisted = await this.store.head(destination.objectKey, signal) !== null;
      if (!overwrite && destinationExisted) {
        throw new RuntimeError("DESTINATION_EXISTS", "Destination file already exists.", 409);
      }
      if (this.totalCopiedBytes + metadata.sizeBytes > this.limits.maxTotalCopiedBytes) {
        throw new RuntimeError("TOTAL_COPY_LIMIT", "Total copy limit exceeded.");
      }
      this.totalCopiedBytes += metadata.sizeBytes;
      copyBytesReserved = true;
      const copied = await this.store.copy(source.objectKey, destination.objectKey, { overwrite }, signal);
      const internal: InternalFileRef = {
        name: destination.relativePath.split("/").at(-1) ?? destination.relativePath,
        path: destination.virtualPath,
        objectKey: destination.objectKey,
        sizeBytes: copied.sizeBytes,
        ...(copied.contentType ? { contentType: copied.contentType } : {}),
        createdBy: "run_code"
      };
      const ref = publicFile(internal);
      if (destinationWasOwned || !destinationExisted) this.currentExecutionArtifacts.add(ref.path);
      this.recordWrittenFile(ref);
      this.mutations.push({ operation: "copied", path: ref.path, sizeBytes: ref.sizeBytes, ...(ref.contentType ? { contentType: ref.contentType } : {}) });
      return ref;
    } catch (error) {
      if (copyBytesReserved) this.totalCopiedBytes -= metadata.sizeBytes;
      throw error;
    } finally {
      this.reservedCopyDestinations.delete(destination.virtualPath);
    }
  }

  private async remove(path: string, signal: AbortSignal): Promise<{ path: string; removed: true }> {
    const resolved = resolvePath(this.mounts, path);
    if (resolved.mount.mode !== "rw" || !resolved.relativePath || !this.currentExecutionArtifacts.has(resolved.virtualPath)) {
      throw new RuntimeError("REMOVE_NOT_ALLOWED", "Only artifacts created in this execution may be removed.", 403);
    }
    const existing = this.writtenFiles.find((file) => file.path === resolved.virtualPath);
    await this.store.delete(resolved.objectKey, signal);
    this.currentExecutionArtifacts.delete(resolved.virtualPath);
    const index = this.writtenFiles.findIndex((file) => file.path === resolved.virtualPath);
    if (index >= 0) this.writtenFiles.splice(index, 1);
    this.mutations.push({
      operation: "removed",
      path: resolved.virtualPath,
      ...(existing?.sizeBytes !== undefined ? { sizeBytes: existing.sizeBytes } : {}),
      ...(existing?.contentType ? { contentType: existing.contentType } : {})
    });
    return { path: resolved.virtualPath, removed: true };
  }

  private reserveReadBytes(bytes: number): void {
    if (this.totalReadBytes + bytes > this.limits.maxTotalReadBytes) {
      throw new RuntimeError("TOTAL_READ_LIMIT", "Total read limit exceeded.");
    }
    this.totalReadBytes += bytes;
  }

  private recordWrittenFile(ref: PublicFileRef): void {
    const prior = this.writtenFiles.findIndex((file) => file.path === ref.path);
    if (prior >= 0) this.writtenFiles.splice(prior, 1);
    this.writtenFiles.push(ref);
  }

  private reserveWriteBytes(bytes: number): void {
    if (this.totalWriteBytes + bytes > this.limits.maxTotalWriteBytes) {
      throw new RuntimeError("TOTAL_WRITE_LIMIT", "Total write limit exceeded.");
    }
    this.totalWriteBytes += bytes;
  }
}
