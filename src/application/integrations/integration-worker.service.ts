import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { IntegrationOrchestratorService } from './integration-orchestrator.service';

/** Persistent, single-process reconciler. Enable explicitly in the worker deployment. */
@Injectable()
export class IntegrationWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationWorkerService.name);
  private timer?: NodeJS.Timeout;
  private currentRun?: Promise<void>;
  private lastRcofDate?: string;

  constructor(private readonly orchestrator: IntegrationOrchestratorService) {}

  onApplicationBootstrap(): void {
    if (process.env.INTEGRATION_WORKER_ENABLED !== 'true') return;
    const interval = Math.max(10_000, Number(process.env.INTEGRATION_WORKER_INTERVAL_MS || 60_000));
    void this.run();
    this.timer = setInterval(() => void this.run(), interval);
    this.timer.unref();
    this.logger.log(`Worker persistente habilitado cada ${interval}ms.`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.currentRun;
  }

  private run(): Promise<void> {
    if (this.currentRun) return this.currentRun;
    this.currentRun = (async () => {
      try {
      await this.orchestrator.tick();
      const now = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date());
      const get = (type: string) => now.find((part) => part.type === type)?.value || '';
      const date = `${get('year')}-${get('month')}-${get('day')}`;
      if (Number(get('hour')) >= Number(process.env.RCOF_DAILY_HOUR || 6) && this.lastRcofDate !== date) {
        await this.orchestrator.rcofDaily();
        this.lastRcofDate = date;
      }
      } catch (error) {
        this.logger.error(`Tick del worker falló: ${(error as Error).message}`, (error as Error).stack);
      } finally {
        this.currentRun = undefined;
      }
    })();
    return this.currentRun;
  }
}
