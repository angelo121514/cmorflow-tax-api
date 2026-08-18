// backend/src/application/integrations/integration-processor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { IDataServices, IntegrationRequestEntity } from '@domain';
import { EmitDteUseCase } from '../dte/emit-dte.use-case';
import { QueryDteStatusUseCase } from '../dte/query-dte-status.use-case';
import { IntegrationStateService, mapDteStatusToPublic } from './integration-state.service';
import { IntegrationQueueClaimer } from './integration-queue.claimer';
import { IntegrationErrorCode } from './integration-errors';
import { IntegrationApiException } from './integration-api.exception';
import { GenerateRcofUseCase } from './generate-rcof.use-case';

/** Tamaño de lote por tick del reconciler. */
const BATCH_SIZE = 5;

/**
 * Procesador asíncrono de solicitudes B2B.
 *
 * Garantía clave de folios: el DTE se crea UNA sola vez por solicitud —
 * tras el primer `prepare` exitoso se persiste `dteId` y los reintentos
 * reutilizan ese documento (retransmisión), jamás un segundo folio.
 *
 * Clasificación de fallos:
 * - Recuperable (timeout/indisponibilidad SII): backoff acotado y reintento.
 * - Rechazo tributario definitivo: llega vía estado SII (poll) → rejected.
 */
@Injectable()
export class IntegrationProcessorService {
  private readonly logger = new Logger(IntegrationProcessorService.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly cls: ClsService,
    private readonly claimer: IntegrationQueueClaimer,
    private readonly stateService: IntegrationStateService,
    private readonly emitDteUseCase: EmitDteUseCase,
    private readonly queryDteStatusUseCase: QueryDteStatusUseCase,
    private readonly generateRcofUseCase: GenerateRcofUseCase,
  ) {}

  /** Reclama y procesa solicitudes vencidas. Disparado post-202 y por cron. */
  async processDue(limit: number = BATCH_SIZE): Promise<{ claimed: number; results: any[] }> {
    const due = await this.claimer.claimDue(limit);
    const results: any[] = [];
    for (const request of due) {
      try {
        const result = await this.processInTenantContext(request);
        results.push({ id: request.id, ...result });
      } catch (err) {
        this.logger.error(`Error procesando solicitud ${request.id}: ${(err as Error).message}`);
        results.push({ id: request.id, error: (err as Error).message });
      }
    }
    return { claimed: due.length, results };
  }

  private async processInTenantContext(request: IntegrationRequestEntity): Promise<any> {
    return this.cls.run({} as any, async () => {
      this.cls.set('tenantId', request.tenantId);
      return this.process(request);
    });
  }

  private async process(request: IntegrationRequestEntity): Promise<any> {
    // kind=rcof: consolidar, firmar, persistir y transmitir vía el use case.
    if (request.kind === 'rcof') {
      return this.processRcof(request);
    }

    const fresh = await firstValueFrom(
      this.dataServices.integrationRequest.get(request.id!),
    );
    if (!fresh) {
      return { skipped: 'request vanished' };
    }

    // El DTE ya existe (reintento): sólo retransmitir o consolidar estado.
    if (fresh.dteId) {
      return this.transmitOrFinalize(fresh);
    }

    // Primera pasada: preparar (reserva folio UNA vez) y persistir dteId
    // antes de cualquier transmisión.
    try {
      const emitDto = this.rebuildEmitDto(fresh);
      const dte = await firstValueFrom(
        this.emitDteUseCase.prepare(emitDto, fresh.tenantId, this.operatorId(fresh)),
      );
      const withDte = await firstValueFrom(
        this.dataServices.integrationRequest.update(fresh.id!, { dteId: dte.id } as any),
      );
      this.logger.log(`Solicitud ${fresh.id}: DTE ${dte.id} (folio ${dte.folio}) reservado y firmado`);
      return this.transmit(withDte!, dte.id!);
    } catch (err) {
      return this.handleProcessingError(fresh, err);
    }
  }

  /** RCOF: idempotente por (tenant, fecha, secuencia) dentro del use case. */
  private async processRcof(fresh: IntegrationRequestEntity): Promise<any> {
    try {
      const rcof = await this.generateRcofUseCase.execute(fresh.tenantId, {
        date: fresh.payload?.date,
        sequenceNumber: fresh.payload?.sequenceNumber,
      });
      await firstValueFrom(
        this.dataServices.integrationRequest.update(fresh.id!, { rcofId: rcof.id } as any),
      );
      return this.stateService.applyState(
        fresh,
        'submitted',
        `RCOF generado y transmitido. TrackID: ${rcof.trackId ?? 'n/a'}`,
      );
    } catch (err) {
      if (err instanceof IntegrationApiException && err.getStatus() === 422) {
        // Fallo de validación definitivo (p. ej. sin boletas ese día).
        return this.stateService.applyState(fresh, 'failed', (err as Error).message);
      }
      return this.handleProcessingError(fresh, err);
    }
  }

  /** Reintento con documento existente: consolidar estado o retransmitir. */
  private async transmitOrFinalize(fresh: IntegrationRequestEntity): Promise<any> {
    const dte = await firstValueFrom(this.dataServices.dteDocument.get(fresh.dteId!));
    if (!dte) {
      return this.handleProcessingError(fresh, new Error('DTE referenciado no existe'));
    }
    const mapped = mapDteStatusToPublic(dte.status);
    if (mapped && ['accepted', 'observed', 'rejected', 'cancelled'].includes(mapped)) {
      // El polling ya resolvió el ciclo; consolidar estado público.
      return this.stateService.applyState(fresh, mapped as any, `Estado SII: ${dte.status}`);
    }
    return this.transmit(fresh, dte.id!);
  }

  private async transmit(fresh: IntegrationRequestEntity, dteId: string): Promise<any> {
    try {
      const result = await firstValueFrom(
        this.emitDteUseCase.transmit(dteId, fresh.tenantId, this.operatorId(fresh)),
      );
      return this.stateService.applyState(
        fresh,
        'submitted',
        `Transmitido al SII. TrackID: ${result?.trackId ?? 'n/a'}`,
        { trackId: result?.trackId ?? null },
      );
    } catch (err) {
      return this.handleProcessingError(fresh, err);
    }
  }

  /**
   * Fallo de transmisión/preparación: los errores de transporte son
   * recuperables (backoff). Los rechazos tributarios definitivos llegan por
   * el estado SII (pollSubmitted), no por la transmisión.
   */
  private async handleProcessingError(fresh: IntegrationRequestEntity, err: any): Promise<any> {
    const message = err instanceof Error ? err.message : String(err);
    const isFolioIssue = /caf|folio/i.test(message);
    const code = isFolioIssue
      ? IntegrationErrorCode.FOLIO_EXHAUSTED
      : IntegrationErrorCode.SII_UNAVAILABLE;
    return this.stateService.scheduleRetry(fresh, { code, message, retryable: true });
  }

  /**
   * Polling de solicitudes `submitted`: consulta el estado al SII por
   * TrackID (QueryDteStatusUseCase actualiza el DTE) y consolida el estado
   * público (accepted/observed/rejected). Fuente de los webhooks finales.
   */
  async pollSubmitted(limit: number = BATCH_SIZE * 4): Promise<{ polled: number; finalized: number }> {
    let finalized = 0;
    const tenants = new Map<string, IntegrationRequestEntity[]>();

    await this.cls.run({} as any, async () => {
      const submitted = await firstValueFrom(
        this.dataServices.integrationRequest.find({ where: { state: 'submitted' } } as any),
      );
      for (const request of submitted.slice(0, limit * 4)) {
        const list = tenants.get(request.tenantId) || [];
        if (list.length < limit) {
          list.push(request);
          tenants.set(request.tenantId, list);
        }
      }
    });

    let polled = 0;
    for (const [tenantId, requests] of tenants) {
      for (const request of requests) {
        polled++;
        if (request.kind === 'rcof') {
          // El RCOF consulta su propio TrackID desde su procesador (M4).
          continue;
        }
        await this.cls.run({} as any, async () => {
          this.cls.set('tenantId', tenantId);
          try {
            const dte = await firstValueFrom(this.dataServices.dteDocument.get(request.dteId!));
            if (!dte?.trackId) {
              return;
            }
            // Refresca el DTE contra el SII (mock en desarrollo/staging mock).
            await firstValueFrom(this.queryDteStatusUseCase.execute(dte.trackId, tenantId));
            const refreshed = await firstValueFrom(this.dataServices.dteDocument.get(dte.id!));
            const mapped = mapDteStatusToPublic(refreshed?.status);
            if (mapped && ['accepted', 'observed', 'rejected', 'cancelled'].includes(mapped)) {
              await this.stateService.applyState(
                request,
                mapped as any,
                `SII responde ${refreshed!.status} para TrackID ${dte.trackId}`,
              );
              finalized++;
            }
          } catch (err) {
            this.logger.warn(
              `Poll de solicitud ${request.id} falló: ${(err as Error).message}`,
            );
          }
        });
      }
    }
    return { polled, finalized };
  }

  /** Polling de solicitudes RCOF `submitted`: consulta TrackID y finaliza. */
  async pollRcofSubmitted(limit = 10): Promise<{ polled: number; finalized: number }> {
    let polled = 0;
    let finalized = 0;
    const requestsByTenant = new Map<string, any[]>();

    await this.cls.run({} as any, async () => {
      const submitted = await firstValueFrom(
        this.dataServices.integrationRequest.find({ where: { state: 'submitted' } } as any),
      );
      for (const request of submitted) {
        if (request.kind !== 'rcof' || !request.rcofId) {
          continue;
        }
        const list = requestsByTenant.get(request.tenantId) || [];
        if (list.length < limit) {
          list.push(request);
          requestsByTenant.set(request.tenantId, list);
        }
      }
    });

    for (const [tenantId, requests] of requestsByTenant) {
      for (const request of requests) {
        polled++;
        await this.cls.run({} as any, async () => {
          this.cls.set('tenantId', tenantId);
          try {
            const rcof = await firstValueFrom(
              this.dataServices.rcofSubmission.get(request.rcofId!),
            );
            if (!rcof || rcof.status !== 'submitted') {
              return;
            }
            const updated = await this.generateRcofUseCase.pollStatus(tenantId, rcof);
            if (['accepted', 'observed', 'rejected'].includes(updated.status)) {
              await this.stateService.applyState(
                request,
                updated.status as any,
                `SII responde ${updated.status} para RCOF ${rcof.periodDate}/${rcof.sequence}`,
              );
              finalized++;
            }
          } catch (err) {
            this.logger.warn(`Poll de RCOF ${request.id} falló: ${(err as Error).message}`);
          }
        });
      }
    }
    return { polled, finalized };
  }

  /** Reconstruye el EmitDteDto validado desde el payload persistido. */
  private rebuildEmitDto(request: IntegrationRequestEntity): any {
    const payload = request.payload;
    const receiver = payload.receiver || {};
    return {
      type: payload.documentType,
      receiverRut: receiver.rut,
      receiverName: receiver.name,
      receiverGiro: receiver.giro,
      receiverAddress: receiver.address,
      receiverCommune: receiver.commune,
      amount: payload.serverTotals?.totalAmount ?? payload.totals?.totalAmount,
      items: (payload.items || []).map((i: any) => ({
        name: i.name,
        quantity: i.quantity,
        price: i.unitPrice,
        exempt: i.exempt,
        discountPercentage: i.discountPercentage,
        discountAmount: i.discountAmount,
      })),
      references: payload.references,
      pricingMode: payload.pricingMode,
      indServicio: payload.indServicio,
      indTraslado: payload.indTraslado,
      transport: payload.transport,
      taxRetentions: payload.taxRetentions,
      globalDiscountPercentage: payload.globalDiscountPercentage,
    };
  }

  private operatorId(request: IntegrationRequestEntity): string {
    return `integration:${request.originCredentialId}`;
  }
}
