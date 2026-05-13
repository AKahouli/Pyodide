/**
 * Options for controlling log behavior
 */
export interface LogOptions {
  /**
   * Control console output (default: true)
   * Set to false to skip console logging (e.g., for sensitive data)
   */
  display?: boolean;

  /**
   * Control database persistence (default: true)
   * Set to false to skip saving to MongoDB (e.g., for high-volume debug logs)
   */
  save?: boolean;

  /**
   * Request ID for tracking logs across a single HTTP request
   * Useful for correlating all logs from a specific request
   */
  requestId?: string;
}
