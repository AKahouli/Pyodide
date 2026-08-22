import { RuntimeError } from "../runtime/errors.js";
import type { ExecutionContext, WorkspaceMount } from "./types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALIAS = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ResolvedPath {
  mount: WorkspaceMount;
  virtualPath: string;
  relativePath: string;
  objectKey: string;
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

export function runPrefix(userId: string, runId: string): string {
  if (!IDENTIFIER.test(userId) || !IDENTIFIER.test(runId)) {
    throw new RuntimeError("INVALID_REQUEST", "Invalid user or run identifier.");
  }
  return `${userId}/system_${runId}`;
}

export function normalizeVirtualPath(path: string): string {
  if (!path || !path.startsWith("/")) {
    throw new RuntimeError("INVALID_PATH", "Workspace paths must be absolute.");
  }
  if (/[\\\0-\x1f\x7f]/.test(path) || /%(?:2e|2f|5c)/i.test(path)) {
    throw new RuntimeError("INVALID_PATH", "Workspace path contains a forbidden sequence.");
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new RuntimeError("INVALID_PATH", "Workspace path traversal is not allowed.");
  }
  return `/${segments.join("/")}`;
}

export function validateMounts(context: ExecutionContext, maxMounts: number): WorkspaceMount[] {
  const expectedRunPrefix = runPrefix(context.userId, context.runId);
  if (!Array.isArray(context.mounts) || context.mounts.length === 0 || context.mounts.length > maxMounts) {
    throw new RuntimeError("INVALID_REQUEST", "Invalid workspace mount count.");
  }

  const mounts = context.mounts.map((mount) => ({
    virtualPath: normalizeVirtualPath(mount.virtualPath),
    cephPrefix: normalizePrefix(mount.cephPrefix),
    mode: mount.mode
  }));
  const writable = mounts.filter((mount) => mount.mode === "rw");
  if (
    writable.length !== 1 ||
    writable[0]?.virtualPath !== "/workspace/run" ||
    writable[0]?.cephPrefix !== expectedRunPrefix
  ) {
    throw new RuntimeError("INVALID_REQUEST", "The writable run mount is invalid.");
  }

  const paths = new Set<string>();
  const prefixes = new Set<string>();
  for (const mount of mounts) {
    if (mount.mode !== "r" && mount.mode !== "rw") {
      throw new RuntimeError("INVALID_REQUEST", "Invalid mount mode.");
    }
    if (!mount.cephPrefix || mount.cephPrefix.includes("//") || mount.cephPrefix.split("/").some((part) => part === "." || part === "..")) {
      throw new RuntimeError("INVALID_REQUEST", "Invalid Ceph prefix.");
    }
    if (mount.mode === "r") {
      const match = /^\/workspace\/sources\/([^/]+)$/.exec(mount.virtualPath);
      if (!match?.[1] || !ALIAS.test(match[1])) {
        throw new RuntimeError("INVALID_REQUEST", "Invalid source mount alias.");
      }
    }
    if (paths.has(mount.virtualPath) || prefixes.has(mount.cephPrefix)) {
      throw new RuntimeError("INVALID_REQUEST", "Duplicate workspace mount.");
    }
    paths.add(mount.virtualPath);
    prefixes.add(mount.cephPrefix);
  }

  for (const left of mounts) {
    for (const right of mounts) {
      if (left === right) continue;
      if (right.virtualPath.startsWith(`${left.virtualPath}/`)) {
        throw new RuntimeError("INVALID_REQUEST", "Overlapping workspace mounts are not allowed.");
      }
    }
  }
  return mounts.sort((a, b) => b.virtualPath.length - a.virtualPath.length);
}

export function resolvePath(mounts: WorkspaceMount[], requestedPath: string): ResolvedPath {
  const virtualPath = normalizeVirtualPath(requestedPath);
  const mount = mounts.find(
    (candidate) => virtualPath === candidate.virtualPath || virtualPath.startsWith(`${candidate.virtualPath}/`)
  );
  if (!mount) throw new RuntimeError("PATH_NOT_MOUNTED", "Path is outside authorized workspace mounts.");
  const relativePath = virtualPath.slice(mount.virtualPath.length).replace(/^\//, "");
  const objectKey = relativePath ? `${mount.cephPrefix}/${relativePath}` : mount.cephPrefix;
  if (objectKey !== mount.cephPrefix && !objectKey.startsWith(`${mount.cephPrefix}/`)) {
    throw new RuntimeError("INVALID_PATH", "Resolved path escaped its workspace mount.");
  }
  return { mount, virtualPath, relativePath, objectKey };
}
