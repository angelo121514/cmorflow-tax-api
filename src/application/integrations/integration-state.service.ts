// backend/src/application/integrations/integration-state.service.ts
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { IDataServices, IntegrationRequestEntity } from '@domain';
import { IntegrationApiException } from './integration-api.exception';
import { IntegrationErrorCode } from './integration-errors';

/** Backoff de reintentos para fallos recuperables (1m, 5m, 15m, 60m, 6h). */
export const INTEGRATION_RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
];

/** Contrato del despachador de eventos webhook (implementado en M3). */
export const INTEGRATION_EVENT_DISPATCHER = 'INTEGRATION_EVENT_DISPATCHER';
export interface IntegrationEventDispatcher {
  dispatchForRequest(
    request: IntegrationRequestEntity,
    state: string,
    detail: string,
  ): Promise<void>;
  dispatchForRcof(rcof: any, state: string, detail: string): Promise<void>;
}

/** Estados internos del DTE → estado público B2B. */
export function mapDteStatusToPublic(dteStatus?: string | null): string | null {
  switch (dteStatus) {
    case 'BORRADOR':
    case 'FIRMADO':
      return 'processing';
    case 'ENVIADO':
      return 'submitted';
    case 'ACEPTADO':
      return 'accepted';
    case 'REPARO':
      return 'observed';
    case 'RECHAZADO':
      return 'rejected';
    case 'ANULADO':
      return 'cancelled';
    default:
      return null;
  }
}

/** Estados que generan evento webhook. */
const NOTIFIABLE_STATES = new Set(['submitted', 'accepted', 'observed', 'rejected', 'failed']);

/** Estados terminales (no admiten transiciones salientes excepto reintento manual). */
const TERMINAL_STATES = new Set(['accepted', 'rejected', 'cancelled']);

/**
 * State machine de solicitudes B2B: sólo se permiten las transiciones listadas.
 * Cualquier transición fuera de este mapa lanza INVALID_STATE_TRANSITION.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  queued: ['processing', 'cancelled'],
  processing: ['submitted', 'failed', 'cancelled'],
  submitted: ['accepted', 'observed', 'rejected', 'failed'],
  accepted: [], // terminal
  observed: ['accepted', 'rejected'], // puede corregirse tras reparo
  rejected: [], // terminal
  failed: ['processing'], // reintento manual
  cancelled: [], // terminal
};

function isTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Transiciones de estado de solicitudes B2B: única puerta de escritura del
 * estado público, su historia y los eventos webhook asociados.
 */
@Injectable()
export class IntegrationStateService {
  private readonly logger = new Logger(IntegrationStateService.name);

  constructor(
    private readonly dataServices: IDataServices,
    @Optional()
    @Inject(INTEGRATION_EVENT_DISPATCHER)
    private readonly eventDispatcher?: IntegrationEventDispatcher,
  ) {}

  async applyState(
    request: IntegrationRequestEntity,
    newState: IntegrationRequestEntity['state'],
    detail: string,
    extra?: { trackId?: string | null },
  ): Promise<IntegrationRequestEntity> {
    if (request.state === newState) {
      return request;
    }

    if (!isTransitionAllowed(request.state, newState)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.INVALID_STATE_TRANSITION,
        `Transición de estado no permitida: ${request.state} → ${newState}.`,
        422,
      );
    }

    const previousState = request.state;
    request.state = newState;
    request.stateHistory = [
      ...(request.stateHistory || []),
      { state: newState, timestamp: new Date().toISOString(), detail, from: previousState },
    ];
    if (newState === 'submitted') {
      request.submittedAt = new Date();
    }
    if (TERMINAL_STATES.has(newState) || newState === 'failed') {
      request.finalizedAt = new Date();
    }
    if (extra?.trackId !== undefined) {
      (request as any).trackIdEcho = extra.trackId ?? null;
    }

    const updated = await firstValueFrom(
      this.dataServices.integrationRequest.update(request.id!, request as any),
    );
    this.logger.log(`Solicitud ${request.id}: ${previousState} → ${newState} (${detail})`);

    if (NOTIFIABLE_STATES.has(newState) && this.eventDispatcher) {
      try {
        await this.eventDispatcher.dispatchForRequest(updated!, newState, detail);
      } catch (err) {
        // La notificación jamás rompe la transición; el reconciler reintenta.
        this.logger.warn(`No se pudo disparar webhook de ${newState}: ${(err as Error).message}`);
      }
    }
    return updated!;  }

  /** Programa el siguiente intento con backoff acotado; agotado → failed. */
  async scheduleRetry(
    request: IntegrationRequestEntity,
    error: { code: string; message: string; retryable: true },
  ): Promise<IntegrationRequestEntity> {
    request.attempts = (request.attempts || 0) + 1;
    request.lastError = error;
    if (request.attempts >= (request.maxAttempts || 5)) {
      return this.applyState(request, 'failed', `Reintentos agotados: ${error.message}`);
    }
    const backoff = INTEGRATION_RETRY_BACKOFF_MS[
      Math.min(request.attempts - 1, INTEGRATION_RETRY_BACKOFF_MS.length - 1)
    ];
    request.nextAttemptAt = new Date(Date.now() + backoff);
    const updated = await firstValueFrom(
      this.dataServices.integrationRequest.update(request.id!, request as any),
    );
    this.logger.warn(
      `Solicitud ${request.id} reintento ${request.attempts}/${request.maxAttempts} en ${backoff / 1000}s: ${error.message}`,
    );
    return updated!;
  }
}
