import type { RuntimeLimits } from "./runtime/limits.js";
import { DEFAULT_LIMITS } from "./runtime/limits.js";
import type { CephConfig } from "./workspace/ceph-s3.js";

export interface ServiceConfig {
  port: number;
  apiKey: string;
  maxHttpBodyBytes: number;
  maxConcurrentExecutions: number;
  maxQueueDepth: number;
  limits: RuntimeLimits;
  ceph: CephConfig;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const limits: RuntimeLimits = {
    maxCodeBytes: positiveInt(env, "RUN_CODE_MAX_CODE_BYTES", DEFAULT_LIMITS.maxCodeBytes),
    maxInputBytes: positiveInt(env, "RUN_CODE_MAX_INPUT_BYTES", DEFAULT_LIMITS.maxInputBytes),
    maxResultBytes: positiveInt(env, "RUN_CODE_MAX_RESULT_BYTES", DEFAULT_LIMITS.maxResultBytes),
    maxLogBytes: positiveInt(env, "RUN_CODE_MAX_LOG_BYTES", DEFAULT_LIMITS.maxLogBytes),
    maxReadFileBytes: positiveInt(env, "RUN_CODE_MAX_READ_FILE_BYTES", DEFAULT_LIMITS.maxReadFileBytes),
    maxWriteFileBytes: positiveInt(env, "RUN_CODE_MAX_WRITE_FILE_BYTES", DEFAULT_LIMITS.maxWriteFileBytes),
    maxTotalReadBytes: positiveInt(env, "RUN_CODE_MAX_TOTAL_READ_BYTES", DEFAULT_LIMITS.maxTotalReadBytes),
    maxTotalWriteBytes: positiveInt(env, "RUN_CODE_MAX_TOTAL_WRITE_BYTES", DEFAULT_LIMITS.maxTotalWriteBytes),
    maxFsOperations: positiveInt(env, "RUN_CODE_MAX_FS_OPERATIONS", DEFAULT_LIMITS.maxFsOperations),
    maxConcurrentFsOperations: positiveInt(env, "RUN_CODE_MAX_CONCURRENT_FS_OPERATIONS", DEFAULT_LIMITS.maxConcurrentFsOperations),
    maxListEntries: positiveInt(env, "RUN_CODE_MAX_LIST_ENTRIES", DEFAULT_LIMITS.maxListEntries),
    maxMounts: positiveInt(env, "RUN_CODE_MAX_MOUNTS", DEFAULT_LIMITS.maxMounts),
    memoryBytes: positiveInt(env, "RUN_CODE_MEMORY_MB", DEFAULT_LIMITS.memoryBytes / 1_048_576) * 1_048_576,
    cpuTimeoutMs: positiveInt(env, "RUN_CODE_CPU_TIMEOUT_MS", DEFAULT_LIMITS.cpuTimeoutMs),
    wallTimeoutMs: positiveInt(env, "RUN_CODE_WALL_TIMEOUT_MS", DEFAULT_LIMITS.wallTimeoutMs)
  };
  if (limits.cpuTimeoutMs > limits.wallTimeoutMs) throw new Error("RUN_CODE_CPU_TIMEOUT_MS cannot exceed wall timeout.");
  if (limits.maxReadFileBytes > limits.maxTotalReadBytes || limits.maxWriteFileBytes > limits.maxTotalWriteBytes) {
    throw new Error("Per-file limits cannot exceed aggregate limits.");
  }
  const maxHttpBodyBytes = positiveInt(env, "RUN_CODE_MAX_HTTP_BODY_BYTES", 4_194_304);
  if (maxHttpBodyBytes <= limits.maxCodeBytes + limits.maxInputBytes) {
    throw new Error("RUN_CODE_MAX_HTTP_BODY_BYTES is too small for configured code and input limits.");
  }
  const endpoint = required(env, "CEPH_S3_ENDPOINT");
  const parsedEndpoint = new URL(endpoint);
  if (!/^https?:$/.test(parsedEndpoint.protocol)) throw new Error("CEPH_S3_ENDPOINT must use HTTP or HTTPS.");
  return {
    port: positiveInt(env, "PORT", 8080),
    apiKey: required(env, "CODE_RUNTIME_API_KEY"),
    maxHttpBodyBytes,
    maxConcurrentExecutions: positiveInt(env, "RUN_CODE_MAX_CONCURRENT_EXECUTIONS", 8),
    maxQueueDepth: positiveInt(env, "RUN_CODE_MAX_QUEUE_DEPTH", 32),
    limits,
    ceph: {
      endpoint,
      region: required(env, "CEPH_S3_REGION"),
      bucket: required(env, "CEPH_S3_BUCKET"),
      accessKeyId: required(env, "CEPH_S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "CEPH_S3_SECRET_ACCESS_KEY"),
      forcePathStyle: boolean(env, "CEPH_S3_FORCE_PATH_STYLE", true)
    }
  };
}
