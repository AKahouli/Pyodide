import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/runtime/limits.js";
import { QuickJsExecutor } from "../src/runtime/quickjs-executor.js";
import { RuntimeError } from "../src/runtime/errors.js";
import type { WorkspaceHost } from "../src/workspace/types.js";

function host(invoke: WorkspaceHost["invoke"] = async () => null): WorkspaceHost {
  return { invoke, writtenFiles: [], mutations: [] };
}

describe("QuickJsExecutor spike", () => {
  it("runs transformations in a fresh context", async () => {
    const executor = new QuickJsExecutor();
    const first = await executor.execute({
      code: "globalThis.leak = 1; return input.filter(x => x.active).map(x => x.id);",
      input: [{ id: 1, active: true }, { id: 2, active: false }],
      host: host(), limits: DEFAULT_LIMITS
    });
    const second = await executor.execute({
      code: "return typeof leak;", input: null, host: host(), limits: DEFAULT_LIMITS
    });
    expect(first.result).toEqual([1]);
    expect(second.result).toBe("undefined");
  });

  it("supports async host calls without ambient Node capabilities", async () => {
    const executor = new QuickJsExecutor();
    const result = await executor.execute({
      code: `
        const value = await fs.readJson('/workspace/sources/data/input.json');
        return { value, process: typeof process, require: typeof require, fetch: typeof fetch };
      `,
      input: null,
      host: host(async (operation) => operation === "readJson" ? { count: 3 } : null),
      limits: DEFAULT_LIMITS
    });
    expect(result.result).toEqual({ value: { count: 3 }, process: "undefined", require: "undefined", fetch: "undefined" });
  });

  it("exposes only the explicit filesystem allowlist", async () => {
    const executor = new QuickJsExecutor();
    const result = await executor.execute({
      code: "return Object.keys(fs).sort();",
      input: null,
      host: host(), limits: DEFAULT_LIMITS
    });
    expect(result.result).toEqual([
      "copy", "find", "glob", "list", "readJson", "readText", "remove", "stat", "writeJson", "writeText"
    ]);
  });

  it("interrupts infinite loops", async () => {
    const executor = new QuickJsExecutor();
    await expect(executor.execute({
      code: "while (true) {}",
      input: null,
      host: host(),
      limits: { ...DEFAULT_LIMITS, cpuTimeoutMs: 25, wallTimeoutMs: 100 }
    })).rejects.toMatchObject({ code: "EXECUTION_TIMEOUT" });
  });

  it("aborts and settles host calls on wall timeout", async () => {
    const executor = new QuickJsExecutor();
    let settled = false;
    await expect(executor.execute({
      code: "return await fs.readText('/workspace/sources/data/slow.txt');",
      input: null,
      host: host((_operation, _args, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { settled = true; reject(new Error("aborted")); }, { once: true });
      })),
      limits: { ...DEFAULT_LIMITS, cpuTimeoutMs: 1_000, wallTimeoutMs: 30 }
    })).rejects.toMatchObject({ code: "EXECUTION_TIMEOUT" });
    expect(settled).toBe(true);
  });

  it("rejects unsupported output values", async () => {
    const executor = new QuickJsExecutor();
    await expect(executor.execute({
      code: "return { value: BigInt(1) };",
      input: null,
      host: host(), limits: DEFAULT_LIMITS
    })).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("requires an explicit return from the submitted function body", async () => {
    const executor = new QuickJsExecutor();
    const setup = `
      const expression = "Array.from({length: 100}, (_, i) => (i + 1) ** 2).reduce((sum, square) => sum + square, 0)";
      const result = Array.from({length: 100}, (_, i) => (i + 1) ** 2).reduce((sum, square) => sum + square, 0);
    `;
    await expect(executor.execute({
      code: `${setup}({ result, expression });`,
      input: null,
      host: host(), limits: DEFAULT_LIMITS
    })).rejects.toMatchObject({ code: "INVALID_OUTPUT" });

    const returned = await executor.execute({
      code: `${setup}return { result, expression };`,
      input: null,
      host: host(), limits: DEFAULT_LIMITS
    });
    expect(returned.result).toEqual({
      result: 338350,
      expression: "Array.from({length: 100}, (_, i) => (i + 1) ** 2).reduce((sum, square) => sum + square, 0)"
    });
  });

  it("enforces the QuickJS memory limit", async () => {
    const executor = new QuickJsExecutor();
    await expect(executor.execute({
      code: "const values = new Uint8Array(100 * 1024 * 1024); return values.length;",
      input: null,
      host: host(),
      limits: { ...DEFAULT_LIMITS, memoryBytes: 8 * 1_048_576, cpuTimeoutMs: 5_000, wallTimeoutMs: 6_000 }
    })).rejects.toMatchObject({ code: "MEMORY_LIMIT" });
  });

  it("rejects non-finite input and truncates logs deterministically", async () => {
    const executor = new QuickJsExecutor();
    await expect(executor.execute({
      code: "return input;", input: { value: Number.NaN }, host: host(), limits: DEFAULT_LIMITS
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    const result = await executor.execute({
      code: "console.log('12345'); console.log('67890'); return true;",
      input: null,
      host: host(),
      limits: { ...DEFAULT_LIMITS, maxLogBytes: 6 }
    });
    expect(result.logs).toEqual(["12345", "[log output truncated]"]);
    expect(result.logsTruncated).toBe(true);
  });

  it("preserves stable host error codes", async () => {
    const executor = new QuickJsExecutor();
    await expect(executor.execute({
      code: "return await fs.readText('/workspace/sources/data/large.txt');",
      input: null,
      host: host(async () => { throw new RuntimeError("FILE_TOO_LARGE", "Workspace file is too large."); }),
      limits: DEFAULT_LIMITS
    })).rejects.toMatchObject({ code: "FILE_TOO_LARGE", recommendedCapability: "mcp-manus" });
  });
});
