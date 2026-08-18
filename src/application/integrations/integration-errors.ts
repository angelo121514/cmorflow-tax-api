// backend/src/application/integrations/integration-errors.ts
/**
 * Catálogo estable de errores de la API B2B /integrations.
 * El código (`error.code`) es parte del contrato público: nunca renombrar.
 */
export const IntegrationErrorCode = {
  API_DISABLED: 'API_DISABLED',
  MISSING_HEADERS: 'MISSING_HEADERS',
  UNKNOWN_KEY: 'UNKNOWN_KEY',
  CREDENTIAL_REVOKED: 'CREDENTIAL_REVOKED',
  CREDENTIAL_EXPIRED: 'CREDENTIAL_EXPIRED',
  CREDENTIAL_TYPE_MISMATCH: 'CREDENTIAL_TYPE_MISMATCH',
  SELF_REVOKE_LAST_ADMIN: 'SELF_REVOKE_LAST_ADMIN',
  TIMESTAMP_OUT_OF_WINDOW: 'TIMESTAMP_OUT_OF_WINDOW',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  NONCE_REPLAYED: 'NONCE_REPLAYED',
  RATE_LIMITED: 'RATE_LIMITED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TOTALS_MISMATCH: 'TOTALS_MISMATCH',
  EXTERNAL_REFERENCE_CONFLICT: 'EXTERNAL_REFERENCE_CONFLICT',
  FOLIO_EXHAUSTED: 'FOLIO_EXHAUSTED',
  SII_REJECTED: 'SII_REJECTED',
  SII_UNAVAILABLE: 'SII_UNAVAILABLE',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type IntegrationErrorCodeValue =
  (typeof IntegrationErrorCode)[keyof typeof IntegrationErrorCode];

/** Permisos que puede portar una credencial B2B. */
export const INTEGRATION_PERMISSIONS = [
  // Operacionales (credencial de API: cmor_live_*)
  'dte:emit',
  'dte:read',
  'dte:cancel',
  'rcof:submit',
  'rcof:read',
  'artifacts:read',
  // Administrativos (credencial admin: cmor_admin_*)
  'webhooks:read',
  'webhooks:write',
  'credentials:read',
  'credentials:write',
] as const;

export type IntegrationPermissionValue = (typeof INTEGRATION_PERMISSIONS)[number];

/** Estados públicos de una solicitud B2B (contrato estable). */
export const INTEGRATION_REQUEST_STATES = [
  'queued',
  'processing',
  'submitted',
  'accepted',
  'observed',
  'rejected',
  'failed',
  'cancelled',
] as const;

/** Eventos webhook que emite la plataforma. */
export const INTEGRATION_WEBHOOK_EVENTS = [
  'dte.submitted',
  'dte.accepted',
  'dte.observed',
  'dte.rejected',
  'dte.failed',
  'rcof.submitted',
  'rcof.accepted',
  'rcof.observed',
  'rcof.rejected',
  'rcof.failed',
] as const;
