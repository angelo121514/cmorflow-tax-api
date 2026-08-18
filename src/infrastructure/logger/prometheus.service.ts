// backend/src/infrastructure/logger/prometheus.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';

/**
 * Servicio de métricas en formato Prometheus (Fase 4).
 *
 * Registra un registro (registry) global y expone métricas estándar + custom:
 * - http_requests_total: contador de requests por método/ruta/status
 * - http_request_duration_seconds: histograma de latencia
 * - ai_provider_latency_seconds: latencia de llamadas al LLM
 * - ai_provider_cost_tokens_total: tokens consumidos por feature
 * - bullmq_jobs_total: jobs procesados por cola/estado
 *
 * El endpoint /metrics expone el output en formato text/plain Prometheus.
 */
@Injectable()
export class PrometheusService implements OnModuleInit {
  private readonly logger = new Logger(PrometheusService.name);
  readonly registry: Registry;

  readonly httpRequestTotal: Counter<string>;
  readonly httpRequestDuration: Histogram<string>;
  readonly aiProviderLatency: Histogram<string>;
  readonly aiProviderTokensTotal: Counter<string>;
  readonly bullmqJobsTotal: Counter<string>;
  readonly activeTenants: Gauge<string>;
  // ── API B2B /integrations ──
  readonly integrationRequestsTotal: Counter<string>;
  readonly integrationRequestDurationSeconds: Histogram<string>;
  readonly siiRejectionsTotal: Counter<string>;
  readonly integrationQueueDepth: Gauge<string>;
  readonly webhookDeliveriesTotal: Counter<string>;
  readonly folioStockGauge: Gauge<string>;

  constructor() {
    this.registry = new Registry();

    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.aiProviderLatency = new Histogram({
      name: 'ai_provider_latency_seconds',
      help: 'AI provider (LLM) call latency',
      labelNames: ['feature'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.aiProviderTokensTotal = new Counter({
      name: 'ai_provider_tokens_total',
      help: 'AI provider tokens consumed',
      labelNames: ['feature'],
      registers: [this.registry],
    });

    this.bullmqJobsTotal = new Counter({
      name: 'bullmq_jobs_total',
      help: 'BullMQ jobs processed',
      labelNames: ['queue', 'status'],
      registers: [this.registry],
    });

    this.activeTenants = new Gauge({
      name: 'active_tenants',
      help: 'Number of active tenants',
      registers: [this.registry],
    });

    // ── API B2B /integrations ──
    this.integrationRequestsTotal = new Counter({
      name: 'integration_requests_total',
      help: 'Solicitudes B2B recibidas por resultado',
      labelNames: ['kind', 'result'],
      registers: [this.registry],
    });

    this.integrationRequestDurationSeconds = new Histogram({
      name: 'integration_request_duration_seconds',
      help: 'Latencia de solicitudes B2B hasta TrackID y hasta aceptación SII',
      labelNames: ['kind', 'phase'],
      buckets: [0.05, 0.5, 1, 5, 30, 120, 600, 3600],
      registers: [this.registry],
    });

    this.siiRejectionsTotal = new Counter({
      name: 'sii_rejections_total',
      help: 'Rechazos del SII por tipo de DTE',
      labelNames: ['document_type'],
      registers: [this.registry],
    });

    this.integrationQueueDepth = new Gauge({
      name: 'integration_queue_depth',
      help: 'Profundidad de la cola B2B por estado',
      labelNames: ['state'],
      registers: [this.registry],
    });

    this.webhookDeliveriesTotal = new Counter({
      name: 'webhook_deliveries_total',
      help: 'Entregas de webhooks B2B por estado',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.folioStockGauge = new Gauge({
      name: 'folio_stock',
      help: 'Folios disponibles por tipo y tenant (salud de folios)',
      labelNames: ['tenant_id', 'document_type', 'health'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Métricas estándar de Node.js (CPU, memoria, event loop, etc.)
    collectDefaultMetrics({ register: this.registry });
    this.logger.log('Prometheus metrics registry inicializado.');
  }

  /** Retorna las métricas en formato text/plain para el endpoint /metrics. */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
