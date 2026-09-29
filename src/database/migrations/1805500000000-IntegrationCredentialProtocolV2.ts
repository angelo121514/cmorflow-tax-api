import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fija explícitamente el protocolo de firma por credencial. Las existentes
 * continúan en v1 hasta su rotación; las nuevas se crean en v2 y usan el
 * secreto original, cifrado en reposo, como clave HMAC.
 */
export class IntegrationCredentialProtocolV21805500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integration_credentials" ADD COLUMN IF NOT EXISTS "signing_version" varchar(8) NOT NULL DEFAULT 'v1'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integration_credentials" DROP COLUMN IF EXISTS "signing_version"`);
  }
}
