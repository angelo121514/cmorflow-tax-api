// Actual HTTP controllers + HMAC + validation, isolated memory data and no SII calls.
process.env.NODE_ENV = 'test';
process.env.INTEGRATIONS_API_ENABLED = 'true';
process.env.SII_MASTER_KEY = 'audit-local-master-key-0123456789abcdef';
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
require('reflect-metadata');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { firstValueFrom } = require('rxjs');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { ClsModule } = require('nestjs-cls');
const { json } = require('express');
const request = require('supertest');
const { IDataServices } = require('../src/domain');
const { FreshMemoryDataServices } = require('../test/helpers/fresh-memory-data.service');
const { DtesController } = require('../src/controllers/dtes.controller');
const { IntegrationControllerHelper } = require('../src/controllers/integration-controller.helper');
const { IntegrationRequestService } = require('../src/application/integrations/integration-request.service');
const { IntegrationProcessorService } = require('../src/application/integrations/integration-processor.service');
const { IntegrationArtifactsService } = require('../src/application/integrations/integration-artifacts.service');
const { IntegrationHmacGuard } = require('../src/infrastructure/guards/integration-hmac.guard');
const { IntegrationSignatureUtil: Hmac } = require('../src/infrastructure/framework/integrations/integration-signature.util');
const { Aes256Cipher } = require('../src/infrastructure/framework/crypto/aes-256-cipher');
const { DteXmlEngine } = require('../src/infrastructure/framework/sii/dte-xml.engine');
const { CafService } = require('../src/infrastructure/framework/sii/caf.service');
const { GlobalExceptionFilter } = require('../src/infrastructure/filters/global-exception.filter');
async function main() {
  const data = new FreshMemoryDataServices();
  data.onModuleInit();
  const engine = new DteXmlEngine(new CafService());
  const module = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
    controllers: [DtesController],
    providers: [IntegrationHmacGuard, Aes256Cipher, IntegrationControllerHelper,
      { provide: IDataServices, useValue: data },
      { provide: IntegrationRequestService, useValue: new IntegrationRequestService(data, engine) },
      { provide: IntegrationProcessorService, useValue: { processDue: async () => ({ claimed: 0 }) } },
      { provide: IntegrationArtifactsService, useValue: {} },
    ],
  }).compile();
  const app = module.createNestApplication({ bodyParser: false });
  app.use(json({ verify: (req, _, body) => { req.rawBody = body; } }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  try {
    for (const [key, tenantId] of [['a', 'tenant-a'], ['b', 'tenant-b']]) {
      await firstValueFrom(data.integrationCredential.create({ id: key, keyId: `cmor_live_${key}`, tenantId, status: 'active', permissions: ['dte:emit', 'dte:read'], secretHash: Hmac.hashSecret('local-test'), secretLast4: 'test' }));
    }
    const results = [];
    const base = { documentType: 33, receiver: { rut: '12345678-5', name: 'Cliente' }, items: [{ name: 'Prueba', quantity: 1, unitPrice: 1190 }] };
    async function call(name, method, path, payload, key = 'a', idem = randomUUID()) {
      const body = payload === undefined ? '' : JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const signature = Hmac.sign(Hmac.hashSecret('local-test'), Hmac.canonicalString(method, path, Hmac.bodyHash(body), ts, nonce));
      let req = request(app.getHttpServer())[method.toLowerCase()](path).set({ 'X-Api-Key': `cmor_live_${key}`, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature, 'Idempotency-Key': idem });
      if (payload !== undefined) req = req.set('Content-Type', 'application/json').send(body);
      const res = await req;
      results.push({ name, status: res.status, body: res.body });
      return res;
    }
    const a = await call('invoiceAccepted', 'POST', '/api/v1/dtes', base, 'a', 'key-a');
    await call('sameBodyReplay', 'POST', '/api/v1/dtes', base, 'a', 'key-a');
    await call('changedBodyConflict', 'POST', '/api/v1/dtes', { ...base, metadata: { changed: true } }, 'a', 'key-a');
    await call('ownTenantRead', 'GET', `/api/v1/dtes/${a.body.requestId}`);
    await call('otherTenantRead', 'GET', `/api/v1/dtes/${a.body.requestId}`, undefined, 'b');
    await call('grossCorrectTotalRejected', 'POST', '/api/v1/dtes', { ...base, pricingMode: 'GROSS', totals: { totalAmount: 1190 } });
    await call('boletaWithoutReceiverAccepted', 'POST', '/api/v1/dtes', { documentType: 39, items: base.items });
    await call('twoDiscounts500', 'POST', '/api/v1/dtes', { ...base, items: [{ ...base.items[0], discountPercentage: 10, discountAmount: 10 }] });
    await call('unknownPricingModeAccepted', 'POST', '/api/v1/dtes', { ...base, pricingMode: 'WRONG' });
    await call('stringFalseAccepted', 'POST', '/api/v1/dtes', { ...base, items: [{ ...base.items[0], exempt: 'false' }] });
    await call('payloadTenantRejected', 'POST', '/api/v1/dtes', { ...base, tenantId: 'tenant-b' });
    const missing = await request(app.getHttpServer()).post('/api/v1/dtes').send(base);
    results.push({ name: 'missingHmacHeaders', status: missing.status });
    fs.mkdirSync('coverage/audit-2026-09-19', { recursive: true });
    fs.writeFileSync('coverage/audit-2026-09-19/http-results.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.map(({ name, status }) => ({ name, status })), null, 2));
  } finally { await app.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
