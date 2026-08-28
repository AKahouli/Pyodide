export class Metrics {
  private requests = 0;
  private successes = 0;
  private active = 0;
  private queueDepth = 0;
  private readonly failures = new Map<string, number>();

  request(): void { this.requests += 1; }
  success(): void { this.successes += 1; }
  failure(code: string): void { this.failures.set(code, (this.failures.get(code) ?? 0) + 1); }
  setActive(value: number): void { this.active = value; }
  setQueueDepth(value: number): void { this.queueDepth = value; }

  render(): string {
    const lines = [
      "# TYPE run_code_requests_total counter",
      `run_code_requests_total ${this.requests}`,
      "# TYPE run_code_success_total counter",
      `run_code_success_total ${this.successes}`,
      "# TYPE run_code_active_executions gauge",
      `run_code_active_executions ${this.active}`,
      "# TYPE run_code_queue_depth gauge",
      `run_code_queue_depth ${this.queueDepth}`
    ];
    for (const [code, count] of [...this.failures].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`run_code_failure_total{code=${JSON.stringify(code)}} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
