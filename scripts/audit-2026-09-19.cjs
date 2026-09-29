// Read-only/local audit reproductions. Run from repository root; no real SII calls.
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
require('reflect-metadata');
const fs = require('fs');
const path = require('path');
const { of, firstValueFrom } = require('rxjs');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { DteXmlEngine } = require('../src/infrastructure/framework/sii/dte-xml.engine');
const { CafService } = require('../src/infrastructure/framework/sii/caf.service');
const { SignatureEngine } = require('../src/infrastructure/framework/sii/signature.engine');
const { CertificateUtils } = require('../src/infrastructure/framework/sii/certificate.utils');
const { IntegrationRequestService } = require('../src/application/integrations/integration-request.service');
const { IntegrationHmacGuard } = require('../src/infrastructure/guards/integration-hmac.guard');
const { IntegrationSignatureUtil: Hmac } = require('../src/infrastructure/framework/integrations/integration-signature.util');
const { Aes256Cipher } = require('../src/infrastructure/framework/crypto/aes-256-cipher');
const { CreateIntegrationDteDto } = require('../src/controllers/dtos/create-integration-dte.dto');
const { GenerateRcofUseCase } = require('../src/application/integrations/generate-rcof.use-case');
const { IntegrationWebhookService } = require('../src/application/integrations/integration-webhook.service');
const { IntegrationProcessorService } = require('../src/application/integrations/integration-processor.service');
const { IntegrationStateService } = require('../src/application/integrations/integration-state.service');
const out = path.resolve('coverage/audit-2026-09-19');
fs.mkdirSync(out, { recursive: true });
const results = {};
const engine = new DteXmlEngine(new CafService());
const service = new IntegrationRequestService({}, engine);
const issuer = { rut: '76123456-0', businessName: 'AUDIT TEST', giro: 'SERVICIOS', acteco: '620100', address: 'Calle 1', commune: 'Santiago' };
const receiver = { rut: '12345678-5', businessName: 'CLIENTE PRUEBA' };
const base = { type: 33, folio: 1, issuer, receiver, items: [{ name: 'Prueba', quantity: 1, price: 1190 }] };
const publicBase = { documentType: 33, receiver: { rut: receiver.rut, name: receiver.businessName }, items: [{ name: 'Prueba', quantity: 1, unitPrice: 1190 }] };
async function main() {
  results.totals = [];
  for (const [name, extra] of [['gross', { pricingMode: 'GROSS' }], ['globalDiscount', { globalDiscountPercentage: 10 }], ['retention', { documentType: 46, taxRetentions: [{ type: 15, rate: 19, amount: 226 }] }]]) {
    const payload = { ...publicBase, ...extra };
    const validated = service.validatePayloadAndTotals(payload).totals;
    const built = engine.buildDte({ ...base, ...extra, type: payload.documentType }).totals;
    let declaredResult;
    try { service.validatePayloadAndTotals({ ...payload, totals: built }); declaredResult = 'accepted'; }
    catch (e) { declaredResult = { status: e.getStatus?.(), message: e.message }; }
    results.totals.push({ name, validated, emitted: built, declaredResult });
  }
  const optional = { documentType: 39, items: [{ name: 'Prueba', quantity: 1, unitPrice: 1000 }] };
  const dto = plainToInstance(CreateIntegrationDteDto, optional);
  results.boletaWithoutReceiver = { dtoErrors: (await validate(dto)).length, validated: service.validatePayloadAndTotals(dto).totals };
  try { engine.buildDte({ ...base, type: 39, receiver: { rut: undefined, businessName: undefined } }); }
  catch(e) { results.boletaWithoutReceiver.emissionError = e.message; }
  results.booleanString = plainToInstance(CreateIntegrationDteDto, { ...publicBase, items: [{ ...publicBase.items[0], exempt: 'false' }] }).items[0].exempt;

  process.env.INTEGRATIONS_API_ENABLED = 'true';
  process.env.SII_MASTER_KEY = 'audit-only-master-key-0123456789abcdef';
  const cipher = new Aes256Cipher();
  const secret = 'audit-only-secret-never-a-real-credential';
  const credential = { id: 'audit-cred', tenantId: 'audit-tenant', keyId: 'cmor_live_audit', status: 'active', permissions: ['dte:read'], secretHash: Hmac.hashSecret(secret), secretEncrypted: cipher.encrypt(secret, process.env.SII_MASTER_KEY) };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'audit-nonce';
  const signature = Hmac.sign(credential.secretHash, Hmac.canonicalString('GET', '/api/v1/dtes/example', Hmac.bodyHash(''), timestamp, nonce));
  const request = { method: 'GET', originalUrl: '/api/v1/dtes/example', rawBody: '', headers: { 'x-api-key': credential.keyId, 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature } };
  const guard = new IntegrationHmacGuard({ getAllAndOverride: () => ['dte:read'] }, { integrationCredential: { findOne: () => of(credential), update: () => of(credential) }, integrationNonce: { findOne: () => of(null), create: x => of(x) } }, { set: () => {} }, cipher);
  results.databaseHashAuthenticatesEncryptedCredential = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }), getHandler: () => null, getClass: () => null });

  let existing = null;
  const fakeRepo = { findOne: () => of(existing), create: x => { existing = { ...x, id: 'request-1' }; return of(existing); } };
  const idempotency = new IntegrationRequestService({ integrationRequest: fakeRepo }, engine);
  const input = { tenantId: 't', credentialId: 'c', kind: 'credit-note', idempotencyKey: 'same-key', rawBody: '{"reasonCode":1}', payload: { originalDteId: 'A' } };
  await idempotency.enqueue(input);
  const replay = await idempotency.enqueue({ ...input, kind: 'debit-note', payload: { originalDteId: 'B' } });
  results.crossOperationIdempotency = { replayed: replay.replayed, returnedKind: replay.request.kind, returnedPayload: replay.request.payload };

  let rcof = null, sends = 0;
  const rcofRepo = { findOne: () => of(rcof), create: x => { rcof = { ...x, id: 'rcof-test' }; return of(rcof); }, update: (_, x) => { rcof = { ...rcof, ...x }; return of(rcof); } };
  const rcofService = new GenerateRcofUseCase({ rcofSubmission: rcofRepo }, engine, {}, { sendDteEnvelope: () => { sends++; throw Error('temporary timeout'); }, queryTrackStatus: (_, token) => { results.rcofPollingToken = token; return of({ status: 'PROCESANDO' }); } }, {}, {});
  rcofService.consolidateDay = async () => [{}];
  rcofService.buildAndSign = async () => '<audit/>';
  rcofService.buildEnvelope = async () => ({ envelopeXml: '<audit/>', token: 'test' });
  try { await rcofService.execute('t', { date: '2026-09-18' }); } catch {}
  const retried = await rcofService.execute('t', { date: '2026-09-18' });
  results.rcofRetry = { sends, returnedStatus: retried.status, trackId: retried.trackId ?? null };
  await rcofService.pollStatus('t', { ...rcof, trackId: '123' });
  // A detached database result is essential: memory repositories can hide stale writes.
  let requestRow = { id: 'r', tenantId: 't', kind: 'rcof', state: 'processing', rcofId: null, stateHistory: [], payload: { date: '2026-09-18' } };
  const detachedData = { integrationRequest: { update: (_, patch) => { requestRow = { ...requestRow, ...structuredClone(patch) }; return of(structuredClone(requestRow)); } } };
  const processor = new IntegrationProcessorService(detachedData, {}, {}, new IntegrationStateService(detachedData), {}, {}, { execute: async () => ({ id: 'rcof-1', trackId: '123', status: 'submitted' }) });
  await processor.processRcof(structuredClone(requestRow));
  results.rcofLinkAfterProcessing = { status: requestRow.state, rcofId: requestRow.rcofId };
  const webhooks = Object.create(IntegrationWebhookService.prototype);
  results.privateIpChecks = Object.fromEntries(['127.0.0.1', '::ffff:127.0.0.1', new URL('https://[::ffff:127.0.0.1]/').hostname.slice(1,-1), 'fe90::1'].map(ip => [ip, webhooks.isPrivateAddress(ip)]));

  const cert = CertificateUtils.generateMockChileanCertificate(issuer.rut, issuer.businessName, receiver.rut, 'AUDIT');
  const signer = new SignatureEngine();
  const seedXml = '<?xml version="1.0" encoding="ISO-8859-1"?><Documento ID="Semilla"><Semilla>123</Semilla></Documento>';
  fs.writeFileSync(path.join(out, 'seed.xml'), Buffer.from(signer.signXml(seedXml, cert.pfxBase64, cert.password, 'Semilla').signedXml, 'latin1'));
  for (const type of [33, 39]) {
    const built = engine.buildDte({ ...base, type, pricingMode: 'NET', indServicio: 3 });
    const signed = signer.signXml(built.xml, cert.pfxBase64, cert.password, 'DocumentoDTE').signedXml;
    fs.writeFileSync(path.join(out, `dte-${type}.xml`), Buffer.from(signed, 'latin1'));
    const env = { issuerRut: issuer.rut, senderRut: receiver.rut, signedDtes: [signed], resolutionDate: '2020-01-01', resolutionNumber: 80 };
    const envelope = type === 39 ? engine.buildEnvioBoleta(env) : engine.buildEnvioDte(env);
    fs.writeFileSync(path.join(out, `unsigned-envelope-${type}.xml`), Buffer.from(envelope, 'latin1'));
    const signedEnv = signer.signXml(envelope, cert.pfxBase64, cert.password, type === 39 ? 'EnvioBOLETA' : 'EnvioDTE').signedXml;
    fs.writeFileSync(path.join(out, `envelope-${type}.xml`), Buffer.from(signedEnv, 'latin1'));
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
