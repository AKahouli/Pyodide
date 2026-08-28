import { createServer } from "node:http";
import { loadConfig, type ServiceConfig } from "./config.js";
import { createExecuteHandler } from "./api/execute.js";
import { QuickJsExecutor } from "./runtime/quickjs-executor.js";
import { Metrics } from "./telemetry/metrics.js";
import { CephS3Store } from "./workspace/ceph-s3.js";
import type { Executor } from "./runtime/executor.js";
import type { ObjectStore } from "./workspace/types.js";

export function buildServer(config: ServiceConfig, executor: Executor, store: ObjectStore) {
  const metrics = new Metrics();
  const execute = createExecuteHandler(config, executor, store, metrics);
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && (url.pathname === "/health/live" || url.pathname === "/health/ready")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (request.method === "GET" && url.pathname === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      response.end(metrics.render());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/execute") {
      void execute(request, response);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"ok":false,"error":{"code":"NOT_FOUND","message":"Not found."}}');
  });
}

if (process.env.NODE_ENV !== "test") {
  const config = loadConfig();
  const server = buildServer(config, new QuickJsExecutor(), new CephS3Store(config.ceph));
  server.listen(config.port, "0.0.0.0");
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
