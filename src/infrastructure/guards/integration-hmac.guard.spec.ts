// backend/src/infrastructure/guards/integration-hmac.guard.spec.ts
import { IntegrationHmacGuard } from './integration-hmac.guard';
import { IntegrationSignatureUtil } from '../framework/integrations/integration-signature.util';
import { MemoryGenericRepository } from '../framework/memory/memory-generic-repository';
import { IntegrationCredentialEntity, IntegrationNonceEntity } from '@domain';

function buildGuard(credential: any | null, opts: { permissions?: string[] } = {}) {
  const integrationCredential = new MemoryGenericRepository<IntegrationCredentialEntity>();
  const integrationNonce = new MemoryGenericRepository<IntegrationNonceEntity>();
  if (credential) {
    integrationCredential.create({ ...credential }).subscribe();
  }
  const dataServices: any = { integrationCredential, integrationNonce };
  const cls = { set: jest.fn(), get: jest.fn() };
  const reflector: any = { getAllAndOverride: jest.fn(() => opts.permissions ?? undefined) };
  const guard = new IntegrationHmacGuard(reflector, dataServices, cls as any);
  return { guard, dataServices, cls, integrationNonce };
}

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SECRET = 'cmc_guard_test_secret';

function seededCredential(overrides: any = {}) {
  return {
    id: 'cred-1',
    tenantId: TENANT_A,
    keyId: 'cmk_test',
    secretHash: IntegrationSignatureUtil.hashSecret(SECRET),
    secretLast4: 'xxxx',
    name: 'test',
    permissions: ['dte:emit', 'dte:read'],
    status: 'active',
    expiresAt: null,
    ...overrides,
  };
}

function makeContext(overrides: any = {}, credential = seededCredential()) {
  const body = JSON.stringify({ documentType: 39, items: [] });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = 'nonce-' + Math.random().toString(36).slice(2);
  const req: any = {
    method: 'POST',
    originalUrl: '/api/v1/integrations/dte',
    url: '/api/v1/integrations/dte',
    rawBody: Buffer.from(body),
    body: JSON.parse(body),
    headers: {
      'x-api-key': 'cmk_test',
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      ...overrides.headers,
    },
  };
  const ctx: any = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  };
  const canonical = IntegrationSignatureUtil.canonicalString(
    req.method,
    req.originalUrl,
    IntegrationSignatureUtil.bodyHash(req.rawBody),
    req.headers['x-timestamp'],
    req.headers['x-nonce'],
  );
  if (!overrides.noSignature) {
    req.headers['x-signature'] =
      overrides.signature ??
      IntegrationSignatureUtil.sign(
        IntegrationSignatureUtil.hashSecret(overrides.secret ?? SECRET),
        canonical,
      );
  }
  return { ctx, req, headers: req.headers };
}

describe('IntegrationHmacGuard — autenticación HMAC fail-closed', () => {
  beforeEach(() => {
    process.env.INTEGRATIONS_API_ENABLED = 'true';
    process.env.INTEGRATION_HMAC_WINDOW_SECONDS = '300';
    process.env.INTEGRATION_RATE_LIMIT_PER_MIN = '60';
  });

  it('API deshabilitada → 404 API_DISABLED', async () => {
    process.env.INTEGRATIONS_API_ENABLED = 'false';
    const { guard } = buildGuard(seededCredential());
    const { ctx } = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'API_DISABLED' } },
    });
  });

  it('headers ausentes → 401 MISSING_HEADERS', async () => {
    const { guard } = buildGuard(seededCredential());
    const { ctx } = makeContext({ noSignature: true, headers: { 'x-signature': undefined } as any });
    ctx.switchToHttp().getRequest().headers = {};
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'MISSING_HEADERS' } },
    });
  });

  it('keyId desconocido → 401 UNKNOWN_KEY', async () => {
    const { guard } = buildGuard(null);
    const { ctx } = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'UNKNOWN_KEY' } },
    });
  });

  it('revocada y expirada → 401 con código específico', async () => {
    const revoked = buildGuard(seededCredential({ status: 'revoked' }));
    await expect(revoked.guard.canActivate(makeContext().ctx)).rejects.toMatchObject({
      response: { error: { code: 'CREDENTIAL_REVOKED' } },
    });

    const expired = buildGuard(
      seededCredential({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(expired.guard.canActivate(makeContext().ctx)).rejects.toMatchObject({
      response: { error: { code: 'CREDENTIAL_EXPIRED' } },
    });
  });

  it('timestamp fuera de ventana → 401 TIMESTAMP_OUT_OF_WINDOW', async () => {
    const { guard } = buildGuard(seededCredential());
    const { ctx } = makeContext({
      headers: { 'x-timestamp': String(Math.floor(Date.now() / 1000) - 3600) },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'TIMESTAMP_OUT_OF_WINDOW' } },
    });
  });

  it('firma inválida (secreto distinto) → 401 INVALID_SIGNATURE', async () => {
    const { guard } = buildGuard(seededCredential());
    const { ctx } = makeContext({ secret: 'cmc_otro_secreto' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'INVALID_SIGNATURE' } },
    });
  });

  it('nonce repetido → 401 NONCE_REPLAYED', async () => {
    const { guard } = buildGuard(seededCredential());
    const first = makeContext();
    await expect(guard.canActivate(first.ctx)).resolves.toBe(true);
    // Segunda petición válida pero con el MISMO nonce.
    const second = makeContext({ headers: { 'x-nonce': first.headers['x-nonce'] } });
    await expect(guard.canActivate(second.ctx)).rejects.toMatchObject({
      response: { error: { code: 'NONCE_REPLAYED' } },
    });
  });

  it('rate limit por credencial → 429 RATE_LIMITED (sin gastar cuota ajena)', async () => {
    process.env.INTEGRATION_RATE_LIMIT_PER_MIN = '2';
    const { guard } = buildGuard(seededCredential());
    await expect(guard.canActivate(makeContext().ctx)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext().ctx)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext().ctx)).rejects.toMatchObject({
      response: { error: { code: 'RATE_LIMITED' } },
    });
  });

  it('permiso faltante → 403 PERMISSION_DENIED', async () => {
    const { guard } = buildGuard(seededCredential(), { permissions: ['webhooks:admin'] });
    await expect(guard.canActivate(makeContext().ctx)).rejects.toMatchObject({
      response: { error: { code: 'PERMISSION_DENIED' } },
    });
  });

  it('x-tenant-id distinto al de la credencial → 403 TENANT_MISMATCH', async () => {
    const { guard, cls } = buildGuard(seededCredential());
    const { ctx } = makeContext({ headers: { 'x-tenant-id': 'otro-tenant' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'TENANT_MISMATCH' } },
    });
    expect(cls.set).not.toHaveBeenCalled();
  });

  it('petición válida: fija tenant desde la credencial y normaliza el header', async () => {
    const { guard, cls } = buildGuard(seededCredential());
    const { ctx, req } = makeContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(cls.set).toHaveBeenCalledWith('tenantId', TENANT_A);
    expect(req.headers['x-tenant-id']).toBe(TENANT_A);
    expect(req.integrationCredential.keyId).toBe('cmk_test');
  });

  it('registra el nonce consumido para antireplay', async () => {
    const { guard, integrationNonce } = buildGuard(seededCredential());
    const { ctx } = makeContext();
    await guard.canActivate(ctx);
    const nonces = (await integrationNonce.getAll().toPromise())!;
    expect(nonces).toHaveLength(1);
    expect(new Date(nonces[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
