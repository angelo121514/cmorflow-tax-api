import { validateRuntimeConfig } from './runtime-config';

describe('validateRuntimeConfig', () => {
  const production = {
    NODE_ENV: 'production', DB_HOST: 'db.example.com', DB_USER: 'app', DB_PASSWORD: 'secret', DB_NAME: 'tax',
    DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'true', SII_MASTER_KEY: 'a-secure-master-key-that-is-longer-than-32',
    SII_INTEGRATION_MODE: 'real', SII_XSD_VALIDATION_ENABLED: 'true',
    INTEGRATION_URL_SECRET: 'a-secure-artifact-secret-longer-than-32',
  } as NodeJS.ProcessEnv;

  it('accepts a complete production configuration', () => {
    expect(() => validateRuntimeConfig(production)).not.toThrow();
  });

  it('fails closed when production would emit using mock SII', () => {
    expect(() => validateRuntimeConfig({ ...production, SII_INTEGRATION_MODE: 'mock' })).toThrow(/real/);
  });

  it('requires secure artifact and metrics secrets', () => {
    expect(() => validateRuntimeConfig({ ...production, INTEGRATION_URL_SECRET: 'short' })).toThrow(/URL_SECRET/);
    expect(() => validateRuntimeConfig({ ...production, METRICS_ENABLED: 'true', METRICS_BEARER_TOKEN: 'short' })).toThrow(/METRICS/);
  });
});
