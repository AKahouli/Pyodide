import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';

interface MetricRecord {
  value: number;
  tags: Record<string, string>;
}

@Injectable()
export class WhatsAppMetricsService {
  private readonly counters = new Map<string, MetricRecord>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(WhatsAppMetricsService.name);
  }

  incrementCounter(name: string, tags: Record<string, string> = {}): void {
    const key = this.metricKey(name, tags);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += 1;
    } else {
      this.counters.set(key, { value: 1, tags });
    }
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  recordHistogram(name: string, valueMs: number): void {
    const entries = this.histograms.get(name);
    if (entries) {
      entries.push(valueMs);
      if (entries.length > 1000) {
        entries.splice(0, entries.length - 1000);
      }
    } else {
      this.histograms.set(name, [valueMs]);
    }
  }

  getSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};

    for (const [key, record] of this.counters) {
      snapshot[`counter.${key}`] = { value: record.value, tags: record.tags };
    }

    for (const [name, value] of this.gauges) {
      snapshot[`gauge.${name}`] = value;
    }

    for (const [name, entries] of this.histograms) {
      if (entries.length === 0) continue;
      const sorted = [...entries].sort((a, b) => a - b);
      snapshot[`histogram.${name}`] = {
        count: sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted[sorted.length - 1],
      };
    }

    return snapshot;
  }

  private metricKey(name: string, tags: Record<string, string>): string {
    const tagEntries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
    const tagStr = tagEntries.map(([k, v]) => `${k}=${v}`).join(',');
    return tagStr ? `${name}|${tagStr}` : name;
  }
}
