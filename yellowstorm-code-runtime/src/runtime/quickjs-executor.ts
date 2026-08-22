import { getQuickJS, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";
import { ERROR_CODES, RuntimeError, asRuntimeError, type ErrorCode } from "./errors.js";
import type { ExecuteInput, ExecutionResult, Executor } from "./executor.js";

const encoder = new TextEncoder();

const WRAPPER_PREFIX = `
(async function run(input, fs, console) {
`;

const WRAPPER_SUFFIX = `
})(__input, __fs, __console).then((value) => {
  const seen = new WeakSet();
  function validate(current) {
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))) throw new TypeError("INVALID_OUTPUT");
      return;
    }
    if (typeof current !== "object") throw new TypeError("INVALID_OUTPUT");
    if (seen.has(current)) throw new TypeError("INVALID_OUTPUT");
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) validate(item);
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype) throw new TypeError("INVALID_OUTPUT");
      for (const key of Object.keys(current)) validate(current[key]);
    }
    seen.delete(current);
  }
  validate(value);
  return JSON.stringify(value);
})`;

export class QuickJsExecutor implements Executor {
  async execute({ code, input, host, limits }: ExecuteInput): Promise<ExecutionResult> {
    const started = Date.now();
    if (typeof code !== "string" || !code.trim()) throw new RuntimeError("INVALID_CODE", "JavaScript code is required.");
    if (encoder.encode(code).byteLength > limits.maxCodeBytes) throw new RuntimeError("CODE_TOO_LARGE", "JavaScript code is too large.");
    let inputJson: string;
    try {
      this.assertJsonCompatible(input ?? null);
      inputJson = JSON.stringify(input ?? null);
    } catch {
      throw new RuntimeError("INVALID_REQUEST", "Input must be JSON-compatible.");
    }
    if (inputJson === undefined) throw new RuntimeError("INVALID_REQUEST", "Input must be JSON-compatible.");
    if (encoder.encode(inputJson).byteLength > limits.maxInputBytes) throw new RuntimeError("INPUT_TOO_LARGE", "Input is too large.");

    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(Math.min(1_048_576, Math.floor(limits.memoryBytes / 8)));
    const cpuDeadline = Date.now() + limits.cpuTimeoutMs;
    const wallDeadline = Date.now() + limits.wallTimeoutMs;
    runtime.setInterruptHandler(() => Date.now() >= cpuDeadline || Date.now() >= wallDeadline);
    const vm = runtime.newContext();
    const abortController = new AbortController();
    const pending = new Set<Promise<void>>();
    const logs: string[] = [];
    let logBytes = 0;
    let logsTruncated = false;
    let wallTimer: NodeJS.Timeout | undefined;
    let promiseHandle: QuickJSHandle | undefined;

    try {
      this.installHostBridge(vm, host, abortController.signal, pending);
      this.installConsole(vm, logs, limits.maxLogBytes, () => { logsTruncated = true; }, () => logBytes, (value) => { logBytes = value; });
      vm.evalCode(`globalThis.__input = JSON.parse(${JSON.stringify(inputJson)});`).unwrap().dispose();
      const evaluation = vm.evalCode(`${WRAPPER_PREFIX}${code}${WRAPPER_SUFFIX}`, "run-code.js");
      if (evaluation.error) {
        const dumped = vm.dump(evaluation.error) as { name?: string; message?: string };
        evaluation.error.dispose();
        if (Date.now() >= cpuDeadline || Date.now() >= wallDeadline || dumped.message?.includes("interrupted")) {
          throw new RuntimeError("EXECUTION_TIMEOUT", "Execution timed out.");
        }
        if (dumped.message?.toLowerCase().includes("memory")) throw new RuntimeError("MEMORY_LIMIT", "Execution exceeded its memory limit.");
        if (dumped.name === "SyntaxError") throw new RuntimeError("INVALID_CODE", "JavaScript code is invalid.");
        throw new RuntimeError("RUNTIME_ERROR", this.safeGuestMessage(dumped));
      }

      promiseHandle = evaluation.value;
      wallTimer = setTimeout(() => abortController.abort(), Math.max(1, wallDeadline - Date.now()));
      const settled = await this.waitForPromise(vm, promiseHandle, wallDeadline, abortController);
      promiseHandle.dispose();
      promiseHandle = undefined;
      const serialized = vm.getString(settled);
      settled.dispose();
      if (encoder.encode(serialized).byteLength > limits.maxResultBytes) throw new RuntimeError("RESULT_TOO_LARGE", "Execution result is too large.");
      return {
        result: JSON.parse(serialized),
        logs: logsTruncated ? [...logs, "[log output truncated]"] : logs,
        logsTruncated,
        writtenFiles: [...host.writtenFiles],
        durationMs: Date.now() - started,
        runtime: "quickjs"
      };
    } catch (error) {
      throw asRuntimeError(error);
    } finally {
      if (wallTimer) clearTimeout(wallTimer);
      abortController.abort();
      await Promise.allSettled([...pending]);
      if (promiseHandle?.alive) promiseHandle.dispose();
      vm.dispose();
      runtime.dispose();
    }
  }

  private async waitForPromise(
    vm: QuickJSContext,
    promiseHandle: QuickJSHandle,
    wallDeadline: number,
    abortController: AbortController
  ): Promise<QuickJSHandle> {
    while (true) {
      const jobs = vm.runtime.executePendingJobs();
      if (jobs.error) {
        const dumped = vm.dump(jobs.error) as { name?: string; message?: string };
        jobs.dispose();
        if (dumped.message?.includes("interrupted")) {
          throw new RuntimeError("EXECUTION_TIMEOUT", "Execution timed out.");
        }
        if (dumped.message?.toLowerCase().includes("memory")) {
          throw new RuntimeError("MEMORY_LIMIT", "Execution exceeded its memory limit.");
        }
        throw new RuntimeError("RUNTIME_ERROR", this.safeGuestMessage(dumped));
      }
      jobs.dispose();
      const state = vm.getPromiseState(promiseHandle);
      if (state.type === "fulfilled") return state.value;
      if (state.type === "rejected") {
        const dumped = vm.dump(state.error) as { name?: string; message?: string; code?: unknown };
        state.error.dispose();
        if (abortController.signal.aborted) throw new RuntimeError("EXECUTION_TIMEOUT", "Execution timed out.");
        if (dumped.message === "INVALID_OUTPUT") throw new RuntimeError("INVALID_OUTPUT", "Result must be JSON-compatible.");
        if (dumped.message?.includes("interrupted")) throw new RuntimeError("EXECUTION_TIMEOUT", "Execution timed out.");
        if (dumped.message?.toLowerCase().includes("memory")) throw new RuntimeError("MEMORY_LIMIT", "Execution exceeded its memory limit.");
        if (typeof dumped.code === "string" && ERROR_CODES.includes(dumped.code as ErrorCode)) {
          throw new RuntimeError(dumped.code as ErrorCode, dumped.message || "Filesystem operation failed.");
        }
        throw new RuntimeError("RUNTIME_ERROR", this.safeGuestMessage(dumped));
      }
      if (Date.now() >= wallDeadline) {
        abortController.abort();
        throw new RuntimeError("EXECUTION_TIMEOUT", "Execution timed out.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  private installHostBridge(
    vm: QuickJSContext,
    host: ExecuteInput["host"],
    signal: AbortSignal,
    pending: Set<Promise<void>>
  ): void {
    const hostCall = vm.newFunction("__hostCall", (operationHandle, argsHandle) => {
      const operation = vm.getString(operationHandle);
      const argsJson = vm.getString(argsHandle);
      const deferred = vm.newPromise();
      const task = host.invoke(operation, JSON.parse(argsJson) as unknown[], signal)
        .then((value) => {
          const handle = vm.newString(JSON.stringify({ ok: true, value }));
          deferred.resolve(handle);
          handle.dispose();
        })
        .catch((error: unknown) => {
          const runtimeError = asRuntimeError(error);
          const handle = vm.newString(JSON.stringify({ ok: false, error: { code: runtimeError.code, message: runtimeError.message } }));
          deferred.resolve(handle);
          handle.dispose();
        })
        .then(() => {
          const jobs = vm.runtime.executePendingJobs();
          jobs.dispose();
        });
      pending.add(task);
      void task.then(
        () => pending.delete(task),
        () => pending.delete(task)
      );
      return deferred.handle;
    });
    vm.setProp(vm.global, "__hostCall", hostCall);
    hostCall.dispose();
    const setup = vm.evalCode(`
      globalThis.__fs = Object.freeze(Object.fromEntries(
        ["list", "stat", "readText", "readJson", "writeText", "writeJson"].map((name) => [name, (...args) =>
          __hostCall(name, JSON.stringify(args)).then((raw) => {
            const response = JSON.parse(raw);
            if (!response.ok) {
              const error = new Error(response.error.message);
              error.code = response.error.code;
              throw error;
            }
            return response.value;
          })
        ])
      ));
    `);
    vm.unwrapResult(setup).dispose();
  }

  private installConsole(
    vm: QuickJSContext,
    logs: string[],
    maxBytes: number,
    markTruncated: () => void,
    getBytes: () => number,
    setBytes: (value: number) => void
  ): void {
    const log = vm.newFunction("log", (...args: QuickJSHandle[]) => {
      const line = args.map((arg) => {
        const value = vm.dump(arg) as unknown;
        return typeof value === "string" ? value : JSON.stringify(value);
      }).join(" ");
      const bytes = encoder.encode(`${line}\n`).byteLength;
      if (getBytes() + bytes <= maxBytes) {
        logs.push(line);
        setBytes(getBytes() + bytes);
      } else {
        markTruncated();
      }
    });
    const consoleObject = vm.newObject();
    vm.setProp(consoleObject, "log", log);
    vm.setProp(vm.global, "__console", consoleObject);
    log.dispose();
    consoleObject.dispose();
  }

  private safeGuestMessage(error: { name?: string; message?: string }): string {
    const message = String(error.message || "Execution failed.").slice(0, 300);
    return `${error.name || "Error"}: ${message}`;
  }

  private assertJsonCompatible(value: unknown, seen = new Set<object>()): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        throw new RuntimeError("INVALID_REQUEST", "Input must contain finite, safely represented numbers.");
      }
      return;
    }
    if (typeof value !== "object") throw new RuntimeError("INVALID_REQUEST", "Input must be JSON-compatible.");
    if (seen.has(value)) throw new RuntimeError("INVALID_REQUEST", "Input must not contain cycles.");
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) this.assertJsonCompatible(item, seen);
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new RuntimeError("INVALID_REQUEST", "Input must contain only JSON objects and arrays.");
      }
      for (const item of Object.values(value as Record<string, unknown>)) {
        this.assertJsonCompatible(item, seen);
      }
    }
    seen.delete(value);
  }
}
