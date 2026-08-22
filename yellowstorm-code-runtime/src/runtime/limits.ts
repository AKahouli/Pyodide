export interface RuntimeLimits {
  maxCodeBytes: number;
  maxInputBytes: number;
  maxResultBytes: number;
  maxLogBytes: number;
  maxReadFileBytes: number;
  maxWriteFileBytes: number;
  maxTotalReadBytes: number;
  maxTotalWriteBytes: number;
  maxFsOperations: number;
  maxConcurrentFsOperations: number;
  maxListEntries: number;
  maxMounts: number;
  memoryBytes: number;
  cpuTimeoutMs: number;
  wallTimeoutMs: number;
}

export const DEFAULT_LIMITS: RuntimeLimits = {
  maxCodeBytes: 16_384,
  maxInputBytes: 2_097_152,
  maxResultBytes: 262_144,
  maxLogBytes: 65_536,
  maxReadFileBytes: 2_097_152,
  maxWriteFileBytes: 5_242_880,
  maxTotalReadBytes: 8_388_608,
  maxTotalWriteBytes: 10_485_760,
  maxFsOperations: 100,
  maxConcurrentFsOperations: 4,
  maxListEntries: 1_000,
  maxMounts: 20,
  memoryBytes: 64 * 1_048_576,
  cpuTimeoutMs: 2_000,
  wallTimeoutMs: 5_000
};
