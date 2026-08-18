// backend/src/infrastructure/framework/integrations/integration-signature.util.ts
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Firma de peticiones y utilidades criptográficas de la API B2B /integrations.
 *
 * ## Contrato de firma
 *
 * Clave de firma: `sha256hex(secreto)` — el cliente deriva su secreto
 * (mostrado una sola vez, prefijo `cmc_…`) con SHA-256 y usa ese hex como
 * clave HMAC. El servidor persiste únicamente ese mismo hash, por lo que
 * puede verificar sin conocer el secreto en claro.
 *
 * String canónico firmado (HMAC-SHA256 hex):
 *
 *   METHOD\n<ruta con query>\n<sha256(body)>\n<timestamp>\n<nonce>
 *
 * - METHOD: HTTP method en mayúsculas.
 * - ruta: la ruta original de la petición, incluido query string
 *   (ej. `/api/v1/integrations/dte?x=1`).
 * - sha256(body): hex del SHA-256 del body crudo; body vacío → hash de la
 *   cadena vacía.
 * - timestamp: epoch en segundos.
 * - nonce: valor único por credencial dentro de la ventana temporal.
 */
export const INTEGRATION_KEY_ID_PREFIX = 'cmor_';
export const INTEGRATION_API_KEY_PREFIX = 'cmor_live_';
export const INTEGRATION_ADMIN_KEY_PREFIX = 'cmor_admin_';
export const INTEGRATION_SECRET_PREFIX = 'cmc_';

const HEX64 = /^[0-9a-f]{64}$/i;

export class IntegrationSignatureUtil {
  /** SHA-256 hex del body crudo (vacío → hash de cadena vacía). */
  static bodyHash(rawBody?: Buffer | string | null): string {
    const buf = rawBody ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)) : Buffer.alloc(0);
    return createHash('sha256').update(buf).digest('hex');
  }

  /** String canónico que ambas partes firman. */
  static canonicalString(
    method: string,
    pathWithQuery: string,
    bodyHash: string,
    timestamp: string,
    nonce: string,
  ): string {
    return [method.toUpperCase(), pathWithQuery, bodyHash, timestamp, nonce].join('\n');
  }

  /**
   * HMAC-SHA256 hex del string canónico usando `sha256hex(secreto)` como
   * clave. `signingKey` debe ser el SHA-256 hex del secreto (cliente) o el
   * `secretHash` persistido (servidor) — son el mismo valor.
   */
  static sign(signingKey: string, canonical: string): string {
    return createHmac('sha256', signingKey).update(canonical).digest('hex');
  }

  /** Comparación en tiempo constante de firmas hex (64 chars). */
  static safeEquals(a: string, b: string): boolean {
    if (!HEX64.test(a) || !HEX64.test(b)) {
      return false;
    }
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  /** SHA-256 hex del secreto — único dato persistido de la credencial. */
  static hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** keyId público. Tipo 'api' → cmor_live_*, 'admin' → cmor_admin_*. */
  static generateKeyId(type: 'api' | 'admin' = 'api'): string {
    const prefix = type === 'admin' ? INTEGRATION_ADMIN_KEY_PREFIX : INTEGRATION_API_KEY_PREFIX;
    return prefix + randomBytes(12).toString('hex');
  }

  /** Determina el tipo de credencial desde el keyId. */
  static keyIdType(keyId: string): 'api' | 'admin' | 'unknown' {
    if (keyId.startsWith(INTEGRATION_ADMIN_KEY_PREFIX)) return 'admin';
    if (keyId.startsWith(INTEGRATION_API_KEY_PREFIX)) return 'api';
    // Compatibilidad con credenciales legacy cmk_*
    return 'unknown';
  }

  /** Secreto mostrado una sola vez (cmc_…) */
  static generateSecret(): string {
    return INTEGRATION_SECRET_PREFIX + randomBytes(24).toString('hex');
  }

  /** Token HMAC (32 hex) para URLs firmadas de artefactos de corta duración. */
  static signUrlToken(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  }
}
