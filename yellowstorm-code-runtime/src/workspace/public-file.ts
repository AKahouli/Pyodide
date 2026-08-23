import type {
  FileSourceKind,
  InternalFileRef,
  PublicFileRef,
  ResolvedFile,
  WorkspaceMount
} from "./types.js";

export function publicFile(ref: InternalFileRef): PublicFileRef {
  return {
    name: ref.name,
    path: ref.path,
    sizeBytes: ref.sizeBytes,
    ...(ref.contentType ? { contentType: ref.contentType } : {}),
    createdBy: "run_code"
  };
}

export function sourceForMount(mount: WorkspaceMount): { kind: FileSourceKind; alias: string } {
  if (mount.virtualPath === "/workspace/run") return { kind: "run", alias: "run" };
  const parts = mount.virtualPath.split("/").filter(Boolean);
  return {
    kind: parts[1] === "attachments" ? "attachment" : "workspace",
    alias: parts.at(-1) ?? "source"
  };
}

export function resolvedFile(
  mount: WorkspaceMount,
  path: string,
  metadata: { sizeBytes: number; modifiedAt?: string; contentType?: string }
): ResolvedFile {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    source: sourceForMount(mount),
    sizeBytes: metadata.sizeBytes,
    ...(metadata.modifiedAt ? { modifiedAt: metadata.modifiedAt } : {}),
    ...(metadata.contentType ? { contentType: metadata.contentType } : {})
  };
}
