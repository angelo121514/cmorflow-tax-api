import { MigrationInterface, QueryRunner } from 'typeorm';

/** La misma Idempotency-Key puede reutilizarse en operaciones distintas. */
export class IntegrationRequestResourceKey1805600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integration_requests" ADD COLUMN IF NOT EXISTS "resource_key" varchar NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "integration_requests" DROP CONSTRAINT IF EXISTS "UQ_integration_requests_tenant_key"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_integration_requests_tenant_kind_resource_key" ON "integration_requests" ("tenant_id", "kind", "resource_key", "idempotency_key")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_integration_requests_tenant_kind_resource_key"`);
    await queryRunner.query(`ALTER TABLE "integration_requests" DROP COLUMN IF EXISTS "resource_key"`);
    await queryRunner.query(`ALTER TABLE "integration_requests" ADD CONSTRAINT "UQ_integration_requests_tenant_key" UNIQUE ("tenant_id", "idempotency_key")`);
  }
}
