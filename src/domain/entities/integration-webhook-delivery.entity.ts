// backend/src/domain/entities/integration-webhook-delivery.entity.ts
/**
 * Intento/programación de entrega de un evento webhook a un endpoint.
 *
 * Las entregas fallidas se reintentan con backoff acotado desde el reconciler.
 * El historial se conserva para diagnóstico y reenvío manual. La consulta
 * (GET) es la fuente de verdad; los webhooks son notificaciones recuperables.
 */
export class IntegrationWebhookDeliveryEntity {
  id?: string;
  tenantId: string;
  eventId: string;
  endpointId: string;
  attempt: number;
  maxAttempts: number;
  /** pending | delivering | delivered | failed | dead */
  status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead';
  nextAttemptAt: Date;
  responseStatus?: number | null;
  responseSnippet?: string | null;
  lastError?: string | null;
  deliveredAt?: Date | null;
  createdAt?: Date;
}
