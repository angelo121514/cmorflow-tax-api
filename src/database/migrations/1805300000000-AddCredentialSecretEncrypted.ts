import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Almacena además el secreto B2B cifrado (AES-256-GCM con SII_MASTER_KEY):
 * la clave de firma HMAC deja de ser directamente el secretHash de la BD
 * (ISSUE auditoría M-1). Las credenciales existentes quedan NULL y siguen
 * operando por el path legacy (secretHash) hasta su rotación.
 */
export class AddCredentialSecretEncrypted1805300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" ADD COLUMN IF NOT EXISTS "secret_encrypted" jsonb NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integration_credentials" DROP COLUMN IF EXISTS "secret_encrypted"`);
  }
}
