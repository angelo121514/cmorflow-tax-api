// backend/src/domain/entities/integration-webhook-endpoint.entity.ts
/**
 * Endpoint webhook registrado por un tenant para recibir eventos de la API B2B.
 *
 * El secreto de firma se almacena cifrado (AES-256-GCM) porque debe poder
 * descifrarse para firmar cada entrega; nunca se devuelve por API.
 */
export class IntegrationWebhookEndpointEntity {
  id?: string;
  tenantId: string;
  /** URL HTTPS destino (debe responder 2xx). */
  url: string;
  /** Secreto de firma cifrado con SII_MASTER_KEY (AES-256-GCM). */
  secretCipher: string;
  secretLast4: string;
  /** Eventos suscritos: dte.submitted, dte.accepted, ..., rcof.* */
  events: string[];
  active: boolean;
  description?: string;
  createdAt?: Date;
}
