// backend/src/domain/entities/integration-webhook-event.entity.ts
/**
 * Evento de negocio disparado por una transición de estado de una solicitud
 * B2B (dte.submitted, dte.accepted, ..., rcof.*). Genera entregas hacia los
 * endpoints suscritos del tenant.
 */
export class IntegrationWebhookEventEntity {
  id?: string;
  tenantId: string;
  /** Tipo de evento, ej. dte.accepted. */
  type: string;
  /** Solicitud que originó el evento. */
  requestId?: string | null;
  /** RCOF que originó el evento. */
  rcofId?: string | null;
  /** Cuerpo del evento entregado al consumidor. */
  payload: any;
  createdAt?: Date;
}
