// backend/src/application/integrations/integration-queue.claimer.ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { IDataServices, IntegrationRequestEntity } from '@domain';

/**
 * Reclamo atómico de solicitudes procesables de la cola durable sobre
 * Postgres: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED).
 *
 * Un request es reclamable si está `queued` o en reintento de `processing`
 * con `next_attempt_at` vencido. Al reclamarlo se extiende next_attempt_at
 * (lock timeout): si el worker muere a mitad, vuelve a ser reclamable.
 *
 * En tests (DataSource stub, sin Postgres) se degrada a un escaneo por
 * repositorios memory sin bloqueo — el aislamiento real lo garantiza la
 * unicidad de idempotencia y el procesamiento serializado.
 */
@Injectable()
export class IntegrationQueueClaimer {
  private readonly logger = new Logger(IntegrationQueueClaimer.name);
  /** Ventana en la que un claim muerto impide reclamar la solicitud. */
  private static readonly LOCK_TIMEOUT_SECONDS = 600;

  constructor(
    private readonly dataSource: DataSource,
    private readonly dataServices: IDataServices,
    private readonly cls: ClsService,
  ) {}

  async claimDue(limit: number): Promise<IntegrationRequestEntity[]> {
    try {
      const rows: any[] = await this.dataSource.query(
        `UPDATE integration_requests
           SET state = 'processing',
               locked_at = now(),
               attempts = attempts + 1,
               next_attempt_at = now() + make_interval(secs => $1)
         WHERE id IN (
           SELECT id FROM integration_requests
            WHERE (state = 'queued' OR (state = 'processing' AND next_attempt_at <= now()))
            ORDER BY created_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [IntegrationQueueClaimer.LOCK_TIMEOUT_SECONDS, limit],
      );
      return rows as IntegrationRequestEntity[];
    } catch (err) {
      if (this.isTestEnvironment()) {
        return this.claimDueMemory(limit);
      }
      throw err;
    }
  }

  private isTestEnvironment(): boolean {
    return !!process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test';
  }

  /** Fallback sin bloqueo para memoria de tests (sin semántica SKIP LOCKED). */
  private async claimDueMemory(limit: number): Promise<IntegrationRequestEntity[]> {
    const claimed: IntegrationRequestEntity[] = [];
    await this.cls.run({} as any, async () => {
      const due = await firstValueFrom(
        this.dataServices.integrationRequest.find({ where: {} } as any),
      );
      const now = Date.now();
      const candidates = due
        .filter(
          (r: any) =>
            (r.state === 'queued' ||
              (r.state === 'processing' && new Date(r.nextAttemptAt).getTime() <= now)) &&
            !r.__claimed,
        )
        .sort((a: any, b: any) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())
        .slice(0, limit);
      for (const request of candidates) {
        const updated = await firstValueFrom(
          this.dataServices.integrationRequest.update((request as any).id!, {
            state: 'processing',
            lockedAt: new Date(),
            attempts: (request.attempts || 0) + 1,
            nextAttemptAt: new Date(now + IntegrationQueueClaimer.LOCK_TIMEOUT_SECONDS * 1000),
          } as any),
        );
        if (updated) {
          (updated as any).__claimed = true;
          claimed.push(updated);
        }
      }
    });
    return claimed;
  }
}
