import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = {
  CODE_RUNTIME_API_KEY: "test-secret",
  CEPH_S3_ENDPOINT: "http://ceph:9000",
  CEPH_S3_REGION: "us-east-1",
  CEPH_S3_BUCKET: "test",
  CEPH_S3_ACCESS_KEY_ID: "key",
  CEPH_S3_SECRET_ACCESS_KEY: "secret"
};

describe("runtime configuration", () => {
  it("loads bounded defaults", () => {
    const config = loadConfig(required);
    expect(config.port).toBe(8080);
    expect(config.limits.memoryBytes).toBe(64 * 1_048_576);
    expect(config.ceph.forcePathStyle).toBe(true);
  });

  it("rejects contradictory and malformed limits", () => {
    expect(() => loadConfig({ ...required, RUN_CODE_CPU_TIMEOUT_MS: "6000" }))
      .toThrow("cannot exceed wall timeout");
    expect(() => loadConfig({ ...required, RUN_CODE_MEMORY_MB: "-1" }))
      .toThrow("positive integer");
    expect(() => loadConfig({ ...required, CEPH_S3_FORCE_PATH_STYLE: "sometimes" }))
      .toThrow("true or false");
  });
});
