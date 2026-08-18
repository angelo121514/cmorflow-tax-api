/**
 * Chequeo de drift del contrato OpenAPI de CmorFlow Tax API.
 *
 * Bootea el AppModule completo con persistencia en memoria (FreshMemoryModule),
 * genera el documento Swagger con la misma configuración que src/main.ts y lo
 * compara (canónicamente) contra el baseline ohbs-openapi.json.
 *
 * Uso:
 *   npm run openapi:check   → falla (exit 1) si hay drift
 *   npm run openapi:update  → reescribe el baseline
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SII_MASTER_KEY = process.env.SII_MASTER_KEY || 'openapi-drift-master-key-min32char';
process.env.SII_INTEGRATION_MODE = process.env.SII_INTEGRATION_MODE || 'mock';
process.env.SII_ENVIRONMENT = process.env.SII_ENVIRONMENT || 'certification';
process.env.INTEGRATIONS_API_ENABLED = 'true';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { DataServicesModule } from '../src/infrastructure/data-service/data-service.module';
import { FreshMemoryModule } from '../test/helpers/fresh-memory.module';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';
import { Global, Module } from '@nestjs/common';

const DATA_SOURCE_STUB: DataSource = {
  isInitialized: true,
  entityMetadatas: [],
  options: { type: 'postgres' },
  getRepository: () => ({}) as never,
  getTreeRepository: () => ({}) as never,
  getMongoRepository: () => ({}) as never,
} as unknown as DataSource;

const ENTITY_MANAGER_STUB: EntityManager = {
  transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({}),
} as unknown as EntityManager;

@Global()
class DataSourceStubModule {
  static forRoot() {
    return {
      module: DataSourceStubModule,
      providers: [
        { provide: DataSource, useValue: DATA_SOURCE_STUB },
        { provide: EntityManager, useValue: ENTITY_MANAGER_STUB },
      ],
      exports: [DataSource, EntityManager],
    };
  }
}

const BASELINE_PATH = resolve(__dirname, '..', 'ohbs-openapi.json');
const UPDATE = process.argv.includes('--update');

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function diffPaths(generated: any, baseline: any): string[] {
  const genPaths = new Set(Object.keys(generated.paths || {}));
  const basePaths = new Set(Object.keys(baseline.paths || {}));
  return [
    ...[...genPaths].filter((p) => !basePaths.has(p)).map((p) => `  + ${p}`),
    ...[...basePaths].filter((p) => !genPaths.has(p)).map((p) => `  - ${p}`),
  ];
}

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    // FreshMemoryModule es @Global: provee IDataServices a todos los módulos.
    // DataSourceStubModule provee DataSource/EntityManager sin conectar a Postgres.
    imports: [DataSourceStubModule.forRoot(), FreshMemoryModule, AppModule],
  })
    // Override DataServicesModule para que no cargue TypeOrmModule.forRootAsync.
    .overrideModule(DataServicesModule)
    .useModule(FreshMemoryModule)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CmorFlow Tax API')
    .setDescription(
      'Plataforma tributaria B2B para facturación electrónica chilena vía API. ' +
      'Emisión asíncrona de DTE, RCOF, webhooks y artefactos XML/PDF. ' +
      'Autenticación HMAC por credencial ligada a un único tenant.',
    )
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey', in: 'header', name: 'X-Api-Key',
        description: 'Autenticación HMAC. Requiere X-Timestamp, X-Nonce y X-Signature. Credenciales API: cmor_live_*, admin: cmor_admin_*.',
      },
      'integration-hmac',
    )
    .addTag('dtes', 'Emisión y consulta de DTE')
    .addTag('rcof', 'Consumo de folios (RCOF)')
    .addTag('credentials', 'Gestión de credenciales (admin)')
    .addTag('webhooks', 'Gestión de webhooks (admin)')
    .addTag('artifacts', 'Descarga de artefactos con URL firmada')
    .addTag('health', 'Health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  await app.close();

  const generated = canonical(document);

  if (!existsSync(BASELINE_PATH) || UPDATE) {
    writeFileSync(BASELINE_PATH, JSON.stringify(document, null, 2) + '\n', 'utf-8');
    console.log(`Baseline OpenAPI actualizado: ${BASELINE_PATH} (${Object.keys(document.paths || {}).length} paths)`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  const baselineCanonical = canonical(baseline);

  if (generated === baselineCanonical) {
    console.log(`OpenAPI sin drift: ${Object.keys(document.paths || {}).length} paths coinciden con el baseline.`);
    return;
  }

  const diffs = diffPaths(document, baseline);
  console.error('OpenAPI drift detectado. Diferencias en paths:');
  diffs.forEach((d) => console.error(d));
  if (diffs.length === 0) {
    console.error('(Sin diferencias en paths — el drift es en schemas o responses.)');
  }
  console.error('\nSi el cambio es intencional:\n  1. npm run openapi:update\n  2. revisar el diff y commitear');
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});