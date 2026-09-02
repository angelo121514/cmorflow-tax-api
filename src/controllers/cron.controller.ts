// src/controllers/cron.controller.ts
import { Controller, Post, HttpCode, HttpStatus, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../infrastructure/decorators/public.decorator';
import { ClsService } from 'nestjs-cls';
import { IntegrationOrchestratorService } from '../application/integrations/integration-orchestrator.service';
import { CronHmacGuard } from '../infrastructure/guards/cron-hmac.guard';

/**
 * Endpoints internos para disparar workers desde GitHub Actions.
 * Protegidos por CronHmacGuard (HMAC con CRON_HMAC_SECRET). Son un fallback
 * operativo; el worker persistente es el mecanismo principal.
 */
@ApiTags('internal')
@Controller('internal/cron')
@Public()
@UseGuards(CronHmacGuard)
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
  @ApiOperation({ summary: 'RCOF diario automático por tenant (zona America/Santiago)' })
  async rcofDaily() {
    return this.runCrossTenant('rcof-daily', () => this.orchestrator.rcofDaily() as Promise<any>);
  }
}
