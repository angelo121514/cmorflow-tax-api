// backend/src/domain/entities/integration-nonce.entity.ts
/**
 * Nonces de solicitudes B2B para protección antireplay.
 *
 * Un nonce es válido una sola vez por credencial dentro de la ventana
 * temporal del HMAC (±300s por defecto). El purgado lo hace el reconciler.
 */
export class IntegrationNonceEntity {
  id?: string;
  /** Credencial que presentó el nonce. */
  credentialId: string;
  nonce: string;
  expiresAt: Date;
  createdAt?: Date;
}
