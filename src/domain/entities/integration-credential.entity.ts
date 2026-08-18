// backend/src/domain/entities/integration-credential.entity.ts
/**
 * Credencial B2B para la API pública /integrations.
 *
 * Una credencial corresponde a UN solo tenant: el tenant se resuelve
 * exclusivamente desde la credencial (fail-closed), nunca desde el payload
 * ni de headers controlables por el cliente.
 *
 * El secreto (`cmc_...`) se muestra UNA sola vez al crearse/rotarse;
 * aquí sólo se almacena su hash SHA-256.
 */
export class IntegrationCredentialEntity {
  id?: string;
  tenantId: string;
  /** Identificador público de la credencial (prefijo `cmk_`). */
  keyId: string;
  /** SHA-256 hex del secreto. Nunca el secreto en claro. */
  secretHash: string;
  /** Últimos 4 caracteres del secreto, para identificarlo en la UI. */
  secretLast4: string;
  /** Etiqueta descriptiva (ej. "CMORAPR staging"). */
  name: string;
  /** Tipo de credencial: 'api' (cmor_live_*) para integradores, 'admin' (cmor_admin_*) para gestión. */
  credentialType: 'api' | 'admin';
  /** Permisos concedidos según INTEGRATION_PERMISSIONS. */
  permissions: string[];
  /** active | revoked */
  status: 'active' | 'revoked';
  /** Expiración opcional de la credencial. */
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  /** Credencial origen en una rotación (la antigua queda revocada tras la gracia). */
  rotatedFromId?: string | null;
  revokedAt?: Date | null;
  createdAt?: Date;
}
