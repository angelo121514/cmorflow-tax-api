// backend/src/application/integrations/integration-credentials.use-case.spec.ts
import { IntegrationCredentialsUseCase } from './integration-credentials.use-case';
import { IntegrationSignatureUtil } from '../../infrastructure/framework/integrations/integration-signature.util';
import { Aes256Cipher } from '../../infrastructure/framework/crypto/aes-256-cipher';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';
import {
  IntegrationCredentialEntity,
  AuditLogEntity,
} from '@domain';

function buildDataServices() {
  return {
    integrationCredential: new MemoryGenericRepository<IntegrationCredentialEntity>(),
    integrationNonce: new MemoryGenericRepository<any>(),
    integrationRequest: new MemoryGenericRepository<any>(),
    auditLog: new MemoryGenericRepository<AuditLogEntity>(),
  } as any;
}

describe('IntegrationCredentialsUseCase — ciclo de vida de credenciales B2B', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let dataServices: any;
  let useCase: IntegrationCredentialsUseCase;

  beforeEach(() => {
    dataServices = buildDataServices();
    useCase = new IntegrationCredentialsUseCase(dataServices, new Aes256Cipher());
  });

  it('crea credencial: secreto una sola vez, hash y secreto cifrado persisten', async () => {
    process.env.SII_MASTER_KEY = 'k'.repeat(32);
    const result = await useCase.create(tenantId, {
      name: 'CMORAPR',
      permissions: ['dte:emit', 'dte:read'],
    });
    expect(result.secret.startsWith('cmc_')).toBe(true);
    expect(result.credential.keyId.startsWith('cmor_live_')).toBe(true);

    const stored = await dataServices.integrationCredential
      .findOne({ where: { keyId: result.credential.keyId } })
      .toPromise();
    expect(stored.secretHash).toBe(IntegrationSignatureUtil.hashSecret(result.secret));
    expect(stored.secretHash).not.toContain(result.secret);
    expect(stored.permissions).toEqual(['dte:emit', 'dte:read']);
    expect(stored.status).toBe('active');

    // El secreto cifrado no contiene el secreto en claro y descifra al original.
    expect(JSON.stringify(stored.secretEncrypted)).not.toContain(result.secret);
    const decrypted = new Aes256Cipher().decrypt(
      stored.secretEncrypted.ciphertext,
      process.env.SII_MASTER_KEY!,
      stored.secretEncrypted.iv,
      stored.secretEncrypted.authTag,
      stored.secretEncrypted.salt,
    );
    expect(decrypted).toBe(result.secret);
    delete process.env.SII_MASTER_KEY;
  });

  it('rechaza permisos inválidos y nombre vacío', async () => {
    await expect(
      useCase.create(tenantId, { name: 'X', permissions: ['admin:god'] as any }),
    ).rejects.toThrow();
    await expect(
      useCase.create(tenantId, { name: '  ', permissions: ['dte:read'] }),
    ).rejects.toThrow();
  });

  it('reserva webhooks:read y webhooks:write para credenciales admin', async () => {
    await expect(
      useCase.create(tenantId, { name: 'API', permissions: ['webhooks:read'] }),
    ).rejects.toThrow(/webhooks:read/);
    await expect(
      useCase.create(tenantId, { name: 'API', permissions: ['webhooks:write'] }),
    ).rejects.toThrow(/webhooks:write/);
    await expect(
      useCase.create(tenantId, {
        name: 'Admin',
        credentialType: 'admin',
        permissions: ['webhooks:read', 'webhooks:write'],
      }),
    ).resolves.toMatchObject({ credential: { credentialType: 'admin' } });
  });

  it('no acepta dte:cancel como permiso v1 hasta que exista una ruta validada', async () => {
    await expect(
      useCase.create(tenantId, { name: 'API', permissions: ['dte:cancel'] as any }),
    ).rejects.toThrow(/dte:cancel/);
  });

  it('no copia dte:cancel heredado a una credencial nueva al rotarla', async () => {
    const { credential } = await useCase.create(tenantId, {
      name: 'Legacy', permissions: ['dte:read'],
    });
    await dataServices.integrationCredential.update(credential.id, {
      permissions: ['dte:read', 'dte:cancel'],
    } as any).toPromise();

    const rotated = await useCase.rotate(tenantId, credential.id);

    expect(rotated.credential.permissions).toEqual(['dte:read']);
  });

  it('lista enmascarado: nunca expone hash ni secreto', async () => {
    const { credential } = await useCase.create(tenantId, {
      name: 'CMORAPR',
      permissions: ['dte:read'],
    });
    const list = await useCase.list(tenantId);
    expect(list).toHaveLength(1);
    expect(list[0].secretLast4).toMatch(/^\*{4}.*$/);
    expect(JSON.stringify(list)).not.toContain('secretHash');
  });

  it('rotar crea credencial nueva y limita la antigua a la gracia de 24h', async () => {
    const original = await useCase.create(tenantId, {
      name: 'CMORAPR',
      permissions: ['dte:emit'],
    });
    const rotated = await useCase.rotate(tenantId, original.credential.id);

    expect(rotated.credential.id).not.toBe(original.credential.id);
    expect(rotated.credential.keyId).not.toBe(original.credential.keyId);

    const old = await dataServices.integrationCredential
      .get(original.credential.id)
      .toPromise();
    const graceMs = new Date(old.expiresAt!).getTime() - Date.now();
    expect(graceMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('revocar impide uso inmediato (status revoked)', async () => {
    const { credential } = await useCase.create(tenantId, {
      name: 'CMORAPR',
      permissions: ['dte:read'],
    });
    await useCase.revoke(tenantId, credential.id);
    const revoked = await dataServices.integrationCredential.get(credential.id).toPromise();
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it('audita ciclo de vida sin secretos', async () => {
    await useCase.create(tenantId, { name: 'CMORAPR', permissions: ['dte:read'] });
    const logs = await dataServices.auditLog.getAll().toPromise();
    expect(logs.some((l: any) => l.action === 'INTEGRATION_CREDENTIAL_CREATED')).toBe(true);
    for (const log of logs) {
      expect(JSON.stringify(log.payload)).not.toContain('cmc_');
    }
  });
});
