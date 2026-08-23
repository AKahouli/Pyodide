import { describe, expect, it } from "vitest";
import { resolvePath, validateMounts } from "../src/workspace/path-resolver.js";

const context = {
  userId: "user-1",
  runId: "run-1",
  mounts: [
    { virtualPath: "/workspace/run", cephPrefix: "user-1/system_run-1", mode: "rw" as const },
    { virtualPath: "/workspace/sources/finance", cephPrefix: "owner-2/immutable-finance", mode: "r" as const }
  ]
};

describe("workspace path security", () => {
  it("resolves only within segment-bounded mounts", () => {
    const mounts = validateMounts(context, 20);
    expect(resolvePath(mounts, "/workspace/sources/finance/report.json").objectKey)
      .toBe("owner-2/immutable-finance/report.json");
    expect(() => resolvePath(mounts, "/workspace/sources/finance-other/report.json"))
      .toThrowError(expect.objectContaining({ code: "PATH_NOT_MOUNTED" }));
  });

  it.each([
    "/workspace/run/../secret",
    "/workspace/run/%2e%2e/secret",
    "/workspace/run\\secret",
    "/workspace/run/\u0000secret"
  ])("rejects unsafe path %s", (path) => {
    const mounts = validateMounts(context, 20);
    expect(() => resolvePath(mounts, path)).toThrowError(expect.objectContaining({ code: "INVALID_PATH" }));
  });

  it("rejects forged writable prefixes and overlapping mounts", () => {
    expect(() => validateMounts({ ...context, mounts: [
      { virtualPath: "/workspace/run", cephPrefix: "other/system_run-1", mode: "rw" }
    ] }, 20)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
    expect(() => validateMounts({ ...context, mounts: [
      ...context.mounts,
      { virtualPath: "/workspace/sources/finance/sub", cephPrefix: "owner-2/other", mode: "r" }
    ] }, 20)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("allows only exact files and their virtual parent directories in file scopes", () => {
    const mounts = validateMounts({ ...context, mounts: [
      context.mounts[0]!,
      {
        virtualPath: "/workspace/attachments/contracts",
        cephPrefix: "owner-2/immutable-finance",
        mode: "r",
        allowedRelativePaths: ["legal/contract.pdf"]
      }
    ] }, 20);
    expect(resolvePath(mounts, "/workspace/attachments/contracts/legal/contract.pdf").objectKey)
      .toBe("owner-2/immutable-finance/legal/contract.pdf");
    expect(() => resolvePath(mounts, "/workspace/attachments/contracts/private.pdf"))
      .toThrowError(expect.objectContaining({ code: "PATH_NOT_MOUNTED" }));
  });
});
