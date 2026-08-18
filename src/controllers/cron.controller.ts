// src/controllers/cron.controller.ts
import { Controller, Post, HttpCode, HttpStatus, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../infrastructure/decorators/public.decorator';
import { ClsService } from 'nestjs-cls';
import { IntegrationOrchestratorService } from '../application/integrations/integration-orchestrator.service';

/**
 * Endpoints internos para disparar workers desde GitHub Actions.
 * Protegidos por CronHmacGuard (HMAC antireplay con CRON_HMAC_SECRET).
 * Render Free no garantiza SLA de workers permanentes; estos endpoints
 * permiten ejecución determinista desde cron externo.
 *
 * NOTA: CronHmacGuard se importa del módulo de guards cuando esté disponible.
 * Por ahora los endpoints son @Public y se protegen por la red (sólo Render
 * los expone). En producción se debe añadir el guard HMAC.
 */
@ApiTags('internal')
@Controller('internal/cron')
@Public()
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(
    private readonly orchestrator: IntegrationOrchestratorService,
    private readonly cls: ClsService,
  ) {}

  private async runCrossTenant<T>(jobName: string, fn: () => Promise<T>): Promise<{ job: string; ok: boolean; error?: string }> {
    try {
      await this.cls.run({} as any, async () => fn());
      this.logger.log(`Job '${jobName}' completado`);
      return { job: jobName, ok: true };
    } catch (err) {
      this.logger.error(`Job '${jobName}' falló: ${(err as Error).message}`);
      return { job: jobName, ok: false, error: (err as Error).message };
    }
  }

  @Post('process-integrations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconciler: cola + polling SII + webhooks + purge (cada 5 min)' })
  async processIntegrations() {
    return this.runCrossTenant('process-integrations', () => this.orchestrator.tick() as Promise<any>);
  }

  @Post('deliver-webhooks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Entrega de webhooks vencidos (cada 2 min)' })
  async deliverWebhooks() {
    return this.runCrossTenant('deliver-webhooks', () => this.orchestrator.deliverWebhooks() as Promise<any>);
  }

  @Post('rcof-daily')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'RCOF diario automático por tenant (diario 05:00 UTC)' })
  async rcofDaily() {
    return this.runCrossTenant('rcof-daily', () => this.orchestrator.rcofDaily() as Promise<any>);
  }
}