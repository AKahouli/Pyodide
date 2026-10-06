import { mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Named imports from the CJS-built SDK inside this ESM package — the ESM-resolution proof
// recorded in contracts/observability/service-registry.json for yellowstorm-code-runtime.
import { _createForTests } from "@yellowmind/observability";

const realWorker = fileURLToPath(new URL("../node_modules/@yellowmind/observability/dist/worker.cjs", import.meta.url));

describe("observability SDK (ESM consumer)", () => {
  it("emits schema-shaped envelopes through the real worker to a file fd", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "obs-esm-"));
    const file = path.join(dir, "events.log");
    const fd = openSync(file, "w");
    try {
      const logger = _createForTests({
        serviceName: "yellowstorm-code-runtime",
        workerPath: realWorker,
        workerEnv: { OBS_WRITER_FD: String(fd) },
      });
      logger.info("service.started", { launcher: "vitest" });
      logger.fatal("service.crashed", { launcher: "vitest", exit_code: 1, error: new Error("proof") });
      await logger.shutdown(1000);

      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
      const envelopes = lines.map((line) => JSON.parse(line));
      expect(envelopes[0]).toMatchObject({
        schema_version: "1.0",
        event_name: "service.started",
        severity_text: "INFO",
        service_name: "yellowstorm-code-runtime",
      });
      expect(envelopes[1]).toMatchObject({ event_name: "service.crashed", severity_text: "FATAL" });
      expect(envelopes[1].error.type).toBe("Error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
