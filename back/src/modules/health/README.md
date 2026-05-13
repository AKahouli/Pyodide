# Health Module

Production-grade health check module for Kubernetes probes and monitoring.

## Endpoints

| Endpoint | Purpose | Use Case |
|----------|---------|----------|
| `GET /health` | Full health check | Monitoring dashboards |
| `GET /health/live` | Liveness probe | Kubernetes liveness probe |
| `GET /health/ready` | Readiness probe | Kubernetes readiness probe |

## Kubernetes Configuration

```yaml
livenessProbe:
  httpGet:
    path: /api/health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3
```

## Response Format

### Full Health Check (`/health`)

```json
{
  "status": "healthy",
  "timestamp": "2024-01-14T12:00:00.000Z",
  "version": "0.0.1",
  "uptime": 3600,
  "checks": {
    "memory": {
      "status": "up",
      "responseTime": 1,
      "message": "Heap usage: 45.2%",
      "lastChecked": "2024-01-14T12:00:00.000Z"
    },
    "eventLoop": {
      "status": "up",
      "responseTime": 0,
      "message": "Event loop delay: 1ms",
      "lastChecked": "2024-01-14T12:00:00.000Z"
    }
  }
}
```

### Liveness Probe (`/health/live`)

```json
{
  "status": "ok"
}
```

### Readiness Probe (`/health/ready`)

```json
{
  "status": "ok",
  "checks": {
    "memory": true
  }
}
```

## Health Checks

| Check | Healthy | Degraded | Unhealthy |
|-------|---------|----------|-----------|
| Memory | Heap < 70% | Heap 70-90% | Heap > 90% |
| Event Loop | Delay < 10ms | Delay 10-100ms | Delay > 100ms |

## Extending Health Checks

Add custom checks in `health.service.ts`:

```typescript
private async checkDatabase(): Promise<HealthCheckDetail> {
  const startTime = Date.now();
  try {
    await this.dataSource.query('SELECT 1');
    return {
      status: 'up',
      responseTime: Date.now() - startTime,
      message: 'Database connected',
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'down',
      responseTime: Date.now() - startTime,
      message: error.message,
      lastChecked: new Date().toISOString(),
    };
  }
}
```

## Rate Limiting

Health endpoints are excluded from rate limiting using `@RateLimitSkip()` decorator.
