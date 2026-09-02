import { DEFAULT_SII_MASTER_KEY } from '../framework/sii/sii-defaults.constant';

const placeholderValues = new Set(['', 'REPLACE_ME', 'CHANGE_ME_GENERATE_A_SECURE_32_CHAR_KEY']);

/** Validates the minimum configuration before accepting production traffic. */
export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const production = env.NODE_ENV === 'production';
  if (!production) return;

  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SII_MASTER_KEY', 'INTEGRATION_URL_SECRET'];
  const missing = required.filter((key) => placeholderValues.has((env[key] || '').trim()));
  if (missing.length) throw new Error(`Configuración de producción incompleta: ${missing.join(', ')}.`);

  const masterKey = env.SII_MASTER_KEY!;
  if (masterKey === DEFAULT_SII_MASTER_KEY || masterKey.length < 32) {
    throw new Error('SII_MASTER_KEY debe ser única y tener al menos 32 caracteres en producción.');
  }
  if ((env.INTEGRATION_URL_SECRET || '').length < 32) {
    throw new Error('INTEGRATION_URL_SECRET debe tener al menos 32 caracteres en producción.');
  }
  if (env.METRICS_ENABLED === 'true' && (env.METRICS_BEARER_TOKEN || '').length < 32) {
    throw new Error('METRICS_BEARER_TOKEN debe tener al menos 32 caracteres cuando las métricas están habilitadas.');
  }
  if (env.SII_INTEGRATION_MODE !== 'real') {
    throw new Error('SII_INTEGRATION_MODE=real es obligatorio en producción.');
  }
  if (env.SII_XSD_VALIDATION_ENABLED !== 'true') {
    throw new Error('SII_XSD_VALIDATION_ENABLED=true es obligatorio en producción.');
  }
  if (env.DB_SSL !== 'true') {
    throw new Error('DB_SSL=true es obligatorio en producción.');
  }
  if (env.DB_SSL_REJECT_UNAUTHORIZED === 'false') {
    throw new Error('DB_SSL_REJECT_UNAUTHORIZED=false no está permitido en producción.');
  }
}
