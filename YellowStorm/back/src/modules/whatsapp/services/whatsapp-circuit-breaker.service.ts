import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  openedAt: number;
  halfOpenAttempts: number;
}

@Injectable()
export class WhatsAppCircuitBreakerService implements OnModuleDestroy {
  private readonly circuits = new Map<string, CircuitEntry>();
  private readonly recoveryTimer: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppCircuitBreakerService.name);
    const intervalMs = 30_000;
    this.recoveryTimer = setInterval(() => this.checkRecovery(), intervalMs);
    this.recoveryTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.recoveryTimer);
  }

  canExecute(key: string): boolean {
    const circuit = this.getOrCreate(key);
    if (circuit.state === 'CLOSED') return true;
    if (circuit.state === 'HALF_OPEN' && circuit.halfOpenAttempts < 1) return true;
    return false;
  }

  recordSuccess(key: string): void {
    const circuit = this.getOrCreate(key);
    if (circuit.state === 'HALF_OPEN') {
      circuit.state = 'CLOSED';
      circuit.failureCount = 0;
      circuit.halfOpenAttempts = 0;
      this.logger.log('WhatsApp circuit breaker recovered', { key });
    } else {
      circuit.failureCount = 0;
    }
  }

  recordFailure(key: string): void {
    const circuit = this.getOrCreate(key);
    circuit.failureCount += 1;
    circuit.lastFailureAt = Date.now();

    if (circuit.failureCount >= this.failureThreshold()) {
      circuit.state = 'OPEN';
      circuit.openedAt = Date.now();
      circuit.halfOpenAttempts = 0;
      this.logger.warn('WhatsApp circuit breaker opened', {
        key,
        failureCount: circuit.failureCount,
        threshold: this.failureThreshold(),
        cooldownMs: this.cooldownMs(),
      });
    }
  }

  getState(key: string): CircuitState {
    return this.getOrCreate(key).state;
  }

  private failureThreshold(): number {
    return this.configService.get<number>('whatsapp.circuitBreakerFailureThreshold', 3);
  }

  private cooldownMs(): number {
    return this.configService.get<number>('whatsapp.circuitBreakerCooldownMs', 60_000);
  }

  private getOrCreate(key: string): CircuitEntry {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = { state: 'CLOSED', failureCount: 0, lastFailureAt: 0, openedAt: 0, halfOpenAttempts: 0 };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  private checkRecovery(): void {
    const cooldown = this.cooldownMs();
    const now = Date.now();
    for (const [key, circuit] of this.circuits) {
      if (circuit.state === 'OPEN' && now - circuit.openedAt >= cooldown) {
        circuit.state = 'HALF_OPEN';
        circuit.halfOpenAttempts = 0;
        this.logger.log('WhatsApp circuit breaker half-open', { key });
      }
    }
  }
}
