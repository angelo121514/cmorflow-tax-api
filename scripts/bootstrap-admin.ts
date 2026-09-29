import AppDataSource from '../src/database/data-source';
import { IntegrationSignatureUtil } from '../src/infrastructure/framework/integrations/integration-signature.util';
import { Aes256Cipher } from '../src/infrastructure/framework/crypto/aes-256-cipher';
import { DEFAULT_SII_MASTER_KEY } from '../src/infrastructure/framework/sii/sii-defaults.constant';
import { INTEGRATION_PERMISSIONS } from '../src/application/integrations/integration-errors';

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('Uso: npm run admin:bootstrap -- <tenant-uuid>');
  }
  await AppDataSource.initialize();
  try {
    const tenant = await AppDataSource.query(`SELECT id FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
    if (!tenant.length) throw new Error(`Tenant ${tenantId} no existe.`);
    const existing = await AppDataSource.query(
      `SELECT id FROM integration_credentials WHERE tenant_id = $1 AND credential_type = 'admin' AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    if (existing.length) throw new Error('El tenant ya tiene una credencial admin activa; usa la API para rotarla.');

    const keyId = IntegrationSignatureUtil.generateKeyId('admin');
    const secret = IntegrationSignatureUtil.generateSecret();
    const masterKey = process.env.SII_MASTER_KEY || DEFAULT_SII_MASTER_KEY;
    if (process.env.NODE_ENV === 'production' && masterKey === DEFAULT_SII_MASTER_KEY) {
      throw new Error('SII_MASTER_KEY es obligatoria en producción para cifrar el secreto de la credencial.');
    }
    const secretEncrypted = new Aes256Cipher().encrypt(secret, masterKey);
    await AppDataSource.query(
      `INSERT INTO integration_credentials
       (tenant_id, key_id, secret_hash, secret_encrypted, signing_version, secret_last4, name, credential_type, permissions, status)
       VALUES ($1, $2, $3, $4, 'v2', $5, 'Bootstrap admin', 'admin', $6, 'active')`,
      [
        tenantId,
        keyId,
        IntegrationSignatureUtil.hashSecret(secret),
        JSON.stringify(secretEncrypted),
        secret.slice(-4),
        INTEGRATION_PERMISSIONS.join(','),
      ],
    );
    console.log(JSON.stringify({ tenantId, keyId, secret }, null, 2));
    console.error('Guarda el secreto ahora: no se volverá a mostrar.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
