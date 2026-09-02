// backend/src/application/integrations/integration-orchestrator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { IDataServices } from '@domain';
import { IntegrationProcessorService } from './integration-processor.service';
import { IntegrationWebhookService } from './integration-webhook.service';
import { GenerateRcofUseCase } from './generate-rcof.use-case';
import { IntegrationJobPort } from './integration-job.port';
import { PrometheusService } from '../../infrastructure/logger/prometheus.service';

/**
 * Orquestador del reconciler: un tick procesa la cola vencida, consulta el
 * estado SII de lo pendiente (DTE y RCOF) y entrega webhooks vencidos.
 * Implementa IntegrationJobPort para que la implementación del worker sea
 * intercambiable (cron hoy, BullMQ/pg-boss mañana) sin tocar use cases.
 */
@Injectable()
export class IntegrationOrchestratorService implements IntegrationJobPort {
  private readonly logger = new Logger(IntegrationOrchestratorService.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly cls: ClsService,
    private readonly dataSource: DataSource,
    private readonly processor: IntegrationProcessorService,
    private readonly webhookService: IntegrationWebhookService,
    private readonly generateRcofUseCase: GenerateRcofUseCase,
    private readonly metrics: PrometheusService,
  ) {}

  /** Tick completo del reconciler (cron cada 5 min). */
  async tick(): Promise<any> {
    const processed = await this.processor.processDue();
    const dtePoll = await this.processor.pollSubmitted();
    const rcofPoll = await this.processor.pollRcofSubmitted();
    const deliveries = await this.webhookService.deliverDue();
    const purged = await this.purgeNonces();
    await this.refreshQueueMetrics();
    return { processed, dtePoll, rcofPoll, deliveries, purgedNonces: purged };
  }

  private async refreshQueueMetrics(): Promise<void> {
    try {
      const rows = await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.worker_scope', 'true', true)`);
        return manager.query(`SELECT state, count(*)::int AS count FROM integration_requests GROUP BY state`);
      });
      this.metrics.integrationQueueDepth.reset();
      for (const row of rows) this.metrics.integrationQueueDepth.set({ state: row.state }, row.count);
    } catch (error) {
      // La observabilidad no debe interrumpir el procesamiento tributario.
      this.logger.warn(`No se pudo actualizar la métrica de cola: ${(error as Error).message}`);
    }
  }

  /** Sólo entregas de webhooks (cron más frecuente si se desea). */
  async deliverWebhooks(): Promise<any> {
    return this.webhookService.deliverDue(20);
  }

  private async purgeNonces(): Promise<number> {
    try {
      const result = await this.dataSource.query(
        `DELETE FROM integration_nonces WHERE expires_at < now()`,
      );
      // TypeORM/pg retorna DELETE como [rows, affectedCount].
      if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
      return Array.isArray(result) ? result.length : 0;
    } catch (err) {
      // En tests (stub) o si la tabla no existe aún: ignorar silenciosamente.
      return 0;
    }
  }

  /**
   * RCOF diario automático por tenant: consolida las boletas 39/41 del día
   * anterior (zona America/Santiago) y transmite el consumo de folios si aún
   * no existe. Idempotente por (tenant, fecha, secuencia=1).
   */
  async rcofDaily(): Promise<{ tenantsChecked: number; generated: number; errors: string[] }> {
    const date = GenerateRcofUseCase.yesterdaySantiago();
    const tenants = await firstValueFrom(this.dataServices.tenant.getAll());
    let generated = 0;
    const errors: string[] = [];

    for (const tenant of tenants) {
      if ((tenant as any).deletedAt) {
        continue;
      }
      try {
        const hasBoletas = await this.cls.run({} as any, async () => {
          this.cls.set('tenantId', tenant.id!);
          const documents = await firstValueFrom(this.dataServices.dteDocument.getAll());
          return documents.some(
            (d: any) =>
              (d.type === 39 || d.type === 41) &&
              d.status !== 'BORRADOR' &&
              ((GenerateRcofUseCase as any).extractXmlValue(d.xmlContent, 'FchEmis') ??
                (d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : '')) === date,
          );
        });
        if (!hasBoletas) {
          continue;
        }
        await this.cls.run({} as any, async () => {
          this.cls.set('tenantId', tenant.id!);
          const rcof = await this.generateRcofUseCase.execute(tenant.id!, { date, sequenceNumber: 1 });
          if (rcof) {
            generated++;
          }
        });
      } catch (err) {
        // Sin boletas ese día es un 422 esperado; otros errores se registran.
        const message = (err as Error).message;
        if (!message.includes('No existen boletas')) {
          errors.push(`${tenant.id}: ${message}`);
        }
      }
    }
    this.logger.log(`rcofDaily ${date}: ${generated} RCOF generados, ${errors.length} errores`);
    return { tenantsChecked: tenants.length, generated, errors };
  }
}
