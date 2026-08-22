import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/main.js";
import { DEFAULT_LIMITS } from "../src/runtime/limits.js";
import { QuickJsExecutor } from "../src/runtime/quickjs-executor.js";
import type { ObjectStore } from "../src/workspace/types.js";

const objects = new Map<string, Uint8Array>();
const store: ObjectStore = {
  async head(key) { return objects.has(key) ? { sizeBytes: objects.get(key)!.byteLength } : null; },
  async list() { return { files: [], prefixes: [], truncated: false }; },
  async read(key) { return objects.get(key) ?? new Uint8Array(); },
  async write(key, body) { objects.set(key, body); }
};

const config = {
  port: 8080,
  apiKey: "test-secret",
  maxHttpBodyBytes: 4_194_304,
  maxConcurrentExecutions: 2,
  maxQueueDepth: 2,
  limits: DEFAULT_LIMITS,
  ceph: {
    endpoint: "http://ceph:9000", region: "us-east-1", bucket: "test",
    accessKeyId: "key", secretAccessKey: "secret", forcePathStyle: true
  }
};

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  objects.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function endpoint() {
  const server = buildServer(config, new QuickJsExecutor(), store);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function requestBody(code: string) {
  return {
    code,
    input: { rows: [1, 2, 3] },
    context: {
      userId: "user-1",
      runId: "run-1",
      mounts: [{ virtualPath: "/workspace/run", cephPrefix: "user-1/system_run-1", mode: "rw" }]
    }
  };
}

describe("runtime HTTP API", () => {
  it("requires bearer authentication", async () => {
    const base = await endpoint();
    const response = await fetch(`${base}/v1/execute`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody("return 1;"))
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
  });

  it("executes code and reports committed writes after a later failure", async () => {
    const base = await endpoint();
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const success = await fetch(`${base}/v1/execute`, {
      method: "POST", headers, body: JSON.stringify(requestBody("return input.rows.reduce((a, b) => a + b, 0);"))
    });
    expect(await success.json()).toMatchObject({ ok: true, result: 6, execution: { runtime: "quickjs" } });

    const failed = await fetch(`${base}/v1/execute`, {
      method: "POST", headers,
      body: JSON.stringify(requestBody("await fs.writeText('/workspace/run/partial.txt', 'saved'); throw new Error('later');"))
    });
    expect(await failed.json()).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_ERROR" },
      writtenFiles: [{ objectKey: "user-1/system_run-1/partial.txt" }]
    });
    expect(new TextDecoder().decode(objects.get("user-1/system_run-1/partial.txt"))).toBe("saved");
  });

  it("exposes liveness, readiness, and metrics", async () => {
    const base = await endpoint();
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
    expect(await (await fetch(`${base}/metrics`)).text()).toContain("run_code_requests_total");
  });
});
