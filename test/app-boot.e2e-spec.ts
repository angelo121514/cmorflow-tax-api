import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { validateRuntimeConfig } from '../src/infrastructure/config/runtime-config';

/**
 * Boot completo del AppModule real (todos los módulos, guards incluidos).
 *
 * Los guards con @UseGuards se instancian en el contexto del módulo del
 * controlador: un provider faltante ahí (p. ej. IDataServices para
 * IntegrationHmacGuard) NO lo detectan los tests unitarios ni los e2e con
 * módulos parciales — sólo este boot. Fue el bloqueante P0 del deploy
 * (la app no arrancaba) que esta prueba hace imposible reintroducir.
 *
 * Corre con Postgres real (POSTGRES_E2E_URL) y configuración de producción
 * válida: además de la DI, verifica que validateRuntimeConfig pasa con el
 * env correcto y que los módulos se resuelven en modo estricto.
 */
const adminUrl = process.env.POSTGRES_E2E_URL;
const describeBoot = adminUrl ? describe : describe.skip;

describeBoot('AppModule boot completo (anti-regresión DI)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const url = new URL(adminUrl!);
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DB_HOST: url.hostname || '127.0.0.1',
      DB_PORT: url.port || '5432',
      DB_USER: url.username || 'postgres',
      DB_PASSWORD: decodeURIComponent(url.password || 'postgres'),
      DB_NAME: url.pathname.replace(/^\//, ''),
      // validateRuntimeConfig exige DB_SSL=true en producción; el host
      // local del e2e queda sin TLS por la excepción de localhost.
      DB_SSL: 'true',
      SII_MASTER_KEY: 'e2e-master-key-0123456789abcdef0123456789abcdef',
      INTEGRATION_URL_SECRET: 'e2e-url-secret-0123456789abcdef0123456789abcdef',
      SII_INTEGRATION_MODE: 'real',
      SII_XSD_VALIDATION_ENABLED: 'true',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: 'e2e-metrics-token-0123456789abcdef012345',
      INTEGRATIONS_API_ENABLED: 'true',
      API_DOCS_ENABLED: 'false',
      AUTO_RUN_MIGRATIONS: 'false',
      INTEGRATION_WORKER_ENABLED: 'false',
    });
    // Mismo gate que main.ts: la config de producción debe pasar ANTES del boot.
    expect(() => validateRuntimeConfig()).not.toThrow();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('inicializa todos los módulos e instancia los guards sin DI rota', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    // Los enhancers (guards HMAC/cron) ya fueron instanciados durante init():
    // si faltara un provider en ControllersModule, init() habría explotado.
    expect(app.getHttpAdapter()).toBeDefined();
  }, 60_000);
});
