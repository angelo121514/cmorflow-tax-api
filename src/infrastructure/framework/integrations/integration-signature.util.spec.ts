// backend/src/infrastructure/framework/integrations/integration-signature.util.spec.ts
import { IntegrationSignatureUtil } from './integration-signature.util';

describe('IntegrationSignatureUtil — contrato de firma B2B', () => {
  const secret = 'cmc_test_secret';
  const signingKey = IntegrationSignatureUtil.hashSecret(secret);

  it('el hash del secreto sirve como clave de firma verificable (cliente y servidor derivan igual)', () => {
    const canonical = IntegrationSignatureUtil.canonicalString(
      'POST',
      '/api/v1/integrations/dte',
      IntegrationSignatureUtil.bodyHash('{"a":1}'),
      '1700000000',
      'nonce-1',
    );
    const signature = IntegrationSignatureUtil.sign(signingKey, canonical);
    expect(IntegrationSignatureUtil.safeEquals(signature, IntegrationSignatureUtil.sign(signingKey, canonical))).toBe(true);
    expect(IntegrationSignatureUtil.safeEquals(signature, 'deadbeef')).toBe(false);
  });

  it('body vacío produce el hash de la cadena vacía y es determinista', () => {
    const h1 = IntegrationSignatureUtil.bodyHash(undefined);
    const h2 = IntegrationSignatureUtil.bodyHash('');
    const h3 = IntegrationSignatureUtil.bodyHash(Buffer.alloc(0));
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h1).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('un cambio en cualquier componente del canónico invalida la firma', () => {
    const parts: [string, string, string, string, string] = ['GET', '/api/v1/integrations/dte?x=1', 'ab'.repeat(32), '1700000000', 'n'];
    const base = IntegrationSignatureUtil.canonicalString(...parts);
    const sig = IntegrationSignatureUtil.sign(signingKey, base);
    const tampered = IntegrationSignatureUtil.canonicalString('POST', parts[1], parts[2], parts[3], parts[4]);
    expect(IntegrationSignatureUtil.safeEquals(sig, IntegrationSignatureUtil.sign(signingKey, tampered))).toBe(false);
  });

  it('safeEquals rechaza firmas que no son hex de 64 caracteres', () => {
    const good = 'a'.repeat(64);
    expect(IntegrationSignatureUtil.safeEquals(good, 'zz')).toBe(false);
    expect(IntegrationSignatureUtil.safeEquals('zz', good)).toBe(false);
    expect(IntegrationSignatureUtil.safeEquals(good, good.toUpperCase())).toBe(true);
  });

  it('genera keyId/secret con prefijos públicos y secretos largos', () => {
    const keyId = IntegrationSignatureUtil.generateKeyId();
    const sec = IntegrationSignatureUtil.generateSecret();
    expect(keyId.startsWith('cmor_live_')).toBe(true);
    expect(sec.startsWith('cmc_')).toBe(true);
    expect(sec.length).toBeGreaterThanOrEqual(50);
  });
});
