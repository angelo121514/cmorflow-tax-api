// backend/src/domain/entities/integration-request.entity.ts
/**
 * Solicitud externa de la API B2B /integrations.
 *
 * Es la fuente de verdad del flujo asíncrono: se persiste ANTES de reservar
 * folio (respuesta 202 inmediata) y actúa como cola durable sobre Postgres
 * (reclamo con FOR UPDATE SKIP LOCKED). El `dteId` se fija tras el primer
 * `prepare` exitoso; los reintentos reutilizan ese documento y jamás
 * reservan un segundo folio.
 */
export class IntegrationRequestEntity {
  id?: string;
  tenantId: string;
  /** dte | credit-note | debit-note | rcof */
  kind: 'dte' | 'credit-note' | 'debit-note' | 'rcof';
  /** Header Idempotency-Key (obligatorio en emisión/anulación). */
  idempotencyKey: string;
  /** SHA-256 del body crudo, para detectar reuso conflictivo de la key (409). */
  requestHash: string;
  /** Referencia de negocio del integrador (ej. ID de consumo CMORAPR). */
  externalReference?: string | null;
  /** Payload validado que se traduce al caso de uso interno. */
  payload: any;
  /** Datos propios del integrador (período APR, cuenta, etc.). Se repiten en estado y webhooks. */
  metadata?: any;
  /** queued | processing | submitted | accepted | observed | rejected | failed | cancelled */
  state:
    | 'queued'
    | 'processing'
    | 'submitted'
    | 'accepted'
    | 'observed'
    | 'rejected'
    | 'failed'
    | 'cancelled';
  /** DTE generado por el motor (una sola vez por solicitud). */
  dteId?: string | null;
  /** RCOF generado (sólo kind=rcof). */
  rcofId?: string | null;
  /** Credencial que originó la solicitud. */
  originCredentialId: string;
  attempts: number;
  maxAttempts: number;
  /** Momento en que la solicitud vuelve a ser reclamable (backoff / lock). */
  nextAttemptAt: Date;
  lockedAt?: Date | null;
  /** Último error normalizado { code, message, retryable }. */
  lastError?: any;
  /** Historial de transiciones [{ state, timestamp, detail }]. */
  stateHistory: any[];
  /** Respuesta 202 original para replay idempotente. */
  responseSnapshot?: any;
  submittedAt?: Date | null;
  finalizedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}
